// Vercel Serverless Function — never place OPENAI_API_KEY in browser code.
const respond = (res,status,body) => res.status(status).setHeader('Cache-Control','no-store').json(body);
const estimateSchema = {
  type:'object',additionalProperties:false,
  properties:{
    items:{type:'array',items:{type:'object',additionalProperties:false,properties:{
      name:{type:'string'},portion:{type:'string'},kcal:{type:'integer'},protein_g:{type:'number'},carbs_g:{type:'number'},fat_g:{type:'number'}
    },required:['name','portion','kcal','protein_g','carbs_g','fat_g']}},
    min_kcal:{type:'integer'},max_kcal:{type:'integer'},assumption:{type:'string'},confidence:{type:'string',enum:['low','medium','high']}
  },required:['items','min_kcal','max_kcal','assumption','confidence']
};
export default async function handler(req,res){
  if(req.method!=='POST')return respond(res,405,{error:'只支援 POST'});
  const apiKey=process.env.OPENAI_API_KEY;
  const supabaseUrl=process.env.SUPABASE_URL;
  const anonKey=process.env.SUPABASE_ANON_KEY;
  if(!apiKey||!supabaseUrl||!anonKey)return respond(res,503,{error:'尚未設定伺服器的 OPENAI_API_KEY、SUPABASE_URL 與 SUPABASE_ANON_KEY'});
  const authHeader=req.headers.authorization||'';
  const token=authHeader.startsWith('Bearer ')?authHeader.slice(7):'';
  if(!token)return respond(res,401,{error:'請先登入'});
  const images=req.body?.images ?? [req.body?.imageDataUrl];
  const notes=String(req.body?.notes||'').slice(0,500);
  const restaurant=String(req.body?.restaurant||'').slice(0,100);
  if(!Array.isArray(images)||images.length<1||images.length>6||
    images.some(img=>typeof img!=='string'||!/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(img))||
    images.reduce((size,img)=>size+img.length,0)>4000000)
    return respond(res,400,{error:'請上傳 1 至 6 張 JPG、PNG 或 WebP 照片，或縮小照片後再試'});
  try{
    // Authenticate against Supabase, not an unverified decoded JWT.
    const authResp=await fetch(`${supabaseUrl.replace(/\/$/,'')}/auth/v1/user`,{headers:{apikey:anonKey,Authorization:`Bearer ${token}`}});
    if(!authResp.ok)return respond(res,401,{error:'登入已過期，請重新登入'});
    const user=await authResp.json();
    if(!user?.id)return respond(res,401,{error:'無效的登入狀態'});
    // One verified member, one shared space. Never use a service-role key here.
    const memberResp=await fetch(`${supabaseUrl.replace(/\/$/,'')}/rest/v1/memberships?select=space_id&user_id=eq.${encodeURIComponent(user.id)}&limit=1`,{headers:{apikey:anonKey,Authorization:`Bearer ${token}`}});
    if(!memberResp.ok)return respond(res,403,{error:'無法確認共用空間身分'});
    const member=await memberResp.json();
    if(!Array.isArray(member)||!member.length)return respond(res,403,{error:'請先加入雙人空間'});
    // Atomic per-user daily request allowance. A failed model call still consumes one attempt.
    const quotaResp=await fetch(`${supabaseUrl.replace(/\/$/,'')}/rest/v1/rpc/claim_analysis`,{method:'POST',headers:{apikey:anonKey,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:'{}'});
    if(!quotaResp.ok)return respond(res,429,{error:'今天的 AI 估算次數已用完（每人每日 20 次）。仍可手動記錄熱量。'});
    const quota=await quotaResp.json();
    if(quota!==true)return respond(res,429,{error:'今天的 AI 估算次數已用完（每人每日 20 次）。'});
    const prompt=`你是餐點營養估算助手。請以繁體中文綜合全部照片與使用者補充說明，分析同一餐可見的餐點與飲料。相同菜色若只是不同角度，不可重複計算，對『照片所見的整份食物』逐項估算總熱量 kcal、蛋白質 g、碳水 g、脂肪 g。只回傳符合 JSON Schema 的資料。\n重要規則：\n1. 依圖片可見數量、餐具與使用者備註估算；避免將兩個人吃的東西合併成單人份。\n2. 照片可能是分享菜、湯飯、飲品或多盤菜，要盡可能逐項分開，最多 10 個食物項目。\n3. 如有實際吃掉的比例備註，可幫助判斷，但 items 的 kcal 仍指該食物拍攝時的完整份量，前端之後會按百分比拆分給兩人。\n4. 若油、醬料、份量不明，要保守標明假設，不要聲稱精準。給出整張照片總熱量的合理高低範圍。\n5. 使用者寫出餐廳名稱不代表你已核實菜單或官方營養數字，不可編造官方資料。\n6. 若圖片不是食物或無法判斷，回傳空 items，並在 assumption 解釋原因。\n7. 各食物的 kcal 和宏量營養估算須大致一致，所有數字非負。\n餐廳 / 菜單文字：${restaurant||'未提供'}\n補充說明：${notes||'未提供'}`;
    const openaiResp=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{'Authorization':`Bearer ${apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({model:process.env.OPENAI_VISION_MODEL||'gpt-4.1-mini',store:false,max_output_tokens:1600,input:[{role:'user',content:[{type:'input_text',text:prompt},...images.map(image_url=>({type:'input_image',image_url,detail:'auto'}))]}],text:{format:{type:'json_schema',name:'food_estimate',strict:true,schema:estimateSchema}}})});
    const answer=await openaiResp.json();
    if(!openaiResp.ok){const msg=answer?.error?.message||'AI 暫時無法處理照片';console.error('OpenAI error:',openaiResp.status,msg);return respond(res,502,{error:'AI 分析暫時失敗，請稍後再試或手動輸入熱量。'})}
    const text=answer.output_text||answer.output?.flatMap(o=>o.content||[]).find(c=>c.type==='output_text')?.text;
    if(!text)return respond(res,502,{error:'AI 沒有提供可辨識的結果，請改用其他照片或手動填寫'});
    let parsed=JSON.parse(text);
    const items=(Array.isArray(parsed.items)?parsed.items:[]).slice(0,10).map(o=>({
      name:String(o.name||'食物').slice(0,100),portion:String(o.portion||'').slice(0,120),
      kcal:Math.min(10000,Math.max(0,Math.round(Number(o.kcal)||0))),
      protein_g:Math.max(0,Number(o.protein_g)||0),carbs_g:Math.max(0,Number(o.carbs_g)||0),fat_g:Math.max(0,Number(o.fat_g)||0)
    }));
    return respond(res,200,{items,min_kcal:Math.max(0,Number(parsed.min_kcal)||0),max_kcal:Math.max(0,Number(parsed.max_kcal)||0),assumption:String(parsed.assumption||'').slice(0,700),confidence:parsed.confidence||'low'});
  }catch(error){console.error('analyze handler error:',error);return respond(res,500,{error:'分析過程發生錯誤，請稍後重試'})}
}
