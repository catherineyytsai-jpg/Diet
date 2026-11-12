/* Daily Plate: no build step. Real mode uses Supabase + Vercel's /api/analyze. */
const $ = (id) => document.getElementById(id);
const config = window.DAILY_PLATE_CONFIG || {};
const hasConfig = !!(config.supabaseUrl && config.supabaseAnonKey && window.supabase);
const client = hasConfig ? window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {auth:{autoRefreshToken:true,persistSession:true,detectSessionInUrl:true}}) : null;
const app = $('app');
const DEMO_USER = 'demo-user-a';
const demoPeople = [
  {user_id:DEMO_USER, slot:'a', display_name:'我', daily_goal:null},
  {user_id:'demo-user-b', slot:'b', display_name:'他', daily_goal:null}
];
const state = {
  demo: !hasConfig, session:null, space:null, members:[], meals:[], imageUrls:{},
  date: dateKey(new Date()), modal:null, busy:false, authMode:'login', notice:'',
  currentForm:null, loading:false, authEmail:''
};
function dateKey(d) {return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')}
function shiftDate(s, n) {let [y,m,d]=s.split('-').map(Number);let a=new Date(y,m-1,d,12);a.setDate(a.getDate()+n);return dateKey(a)}
function dayLabel(s) {const [y,m,d]=s.split('-').map(Number);return `${m} 月 ${d} 日`}
function weekday(s) {const [y,m,d]=s.split('-').map(Number);return ['週日','週一','週二','週三','週四','週五','週六'][new Date(y,m-1,d,12).getDay()]}
function newUUID() { if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID(); let bytes=new Uint8Array(16); if (globalThis.crypto?.getRandomValues) crypto.getRandomValues(bytes); else for(let i=0;i<16;i++)bytes[i]=Math.floor(Math.random()*256); bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;return [...bytes].map(x=>x.toString(16).padStart(2,'0')).join('').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/,'$1-$2-$3-$4-$5'); }
function escapeHtml(x) {return String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function n(x) {let v=Number(x);return Number.isFinite(v)?v:0}
function whole(x){return Math.round(n(x)).toLocaleString('zh-TW')}
function fixed(x){return (Math.round(n(x)*10)/10).toLocaleString('zh-TW')}
function safePercent(x){return Math.min(100,Math.max(0,n(x)))}
function mealNames(type){return ({breakfast:'早餐',lunch:'午餐',dinner:'晚餐',snack:'點心 / 飲料'})[type]||'其他'}
function mealEmoji(type){return ({breakfast:'🥣',lunch:'🍚',dinner:'🍽️',snack:'☕'})[type]||'🍽️'}
function currentUserId(){return state.demo?DEMO_USER:state.session?.user?.id}
function currentMember(){return state.members.find(m=>m.user_id===currentUserId())}
function orderedMembers(){return [...state.members].sort((a,b)=>a.slot.localeCompare(b.slot))}
function defaultItem(name='餐點',kcal=0,protein=0,carbs=0,fat=0,portion=''){return {id:newUUID(),name,kcal:Math.round(n(kcal)),protein_g:n(protein),carbs_g:n(carbs),fat_g:n(fat),portion,shares:Object.fromEntries(state.members.map(m=>[m.user_id,m.user_id===currentUserId()?100:0]))}}
function getShare(item,userId){return safePercent(item.shares?.[userId]??0)/100}
function personTotals(meals,personId){let out={kcal:0,protein:0,carbs:0,fat:0};meals.forEach(meal=>(meal.items||[]).forEach(item=>{const factor=getShare(item,personId);out.kcal+=n(item.kcal)*factor;out.protein+=n(item.protein_g)*factor;out.carbs+=n(item.carbs_g)*factor;out.fat+=n(item.fat_g)*factor}));return out}
function mealsOnDay(){return state.meals.filter(m=>m.day===state.date).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at))}
function toast(msg){document.querySelector('.toast')?.remove();const el=document.createElement('div');el.className='toast';el.textContent=msg;document.body.append(el);setTimeout(()=>el.remove(),3500)}
function setBusy(b){state.busy=b;document.querySelector('.loading-overlay')?.remove();if(b){const el=document.createElement('div');el.className='loading-overlay';el.textContent='處理中…';document.body.append(el)}}
function friendlyError(err){let msg=err?.message||String(err);if(msg.includes('Invalid login credentials'))return '電子郵件或密碼不正確';if(msg.includes('Email not confirmed'))return '請先到信箱完成驗證';if(msg.includes('User already registered'))return '此 Email 已註冊，請登入';if(msg.includes('rate limit'))return '操作太頻繁，請稍後重試';return msg}
function demoRead(){try {return JSON.parse(localStorage.getItem('daily-plate-demo-v1')||'[]')}catch{return []}}
function demoWrite(){try{localStorage.setItem('daily-plate-demo-v1',JSON.stringify(state.meals))}catch{state.meals=demoRead();throw new Error('瀏覽器儲存空間已滿，請減少照片後再試')}}
async function boot(){if(state.demo){state.members=structuredClone(localStorage.getItem('daily-plate-solo')==='true'?demoPeople.slice(0,1):demoPeople);try{const goals=JSON.parse(localStorage.getItem('daily-plate-demo-goals')||'{}');state.members.forEach(m=>m.daily_goal=goals[m.user_id]||null)}catch{}state.meals=demoRead();render();return}
 try{const {data,error}=await client.auth.getSession();if(error)throw error;state.session=data.session;await loadWorkspace();render()}catch(e){state.notice=friendlyError(e);render()}
 client.auth.onAuthStateChange((evt,session)=>{if(evt==='SIGNED_OUT'){state.session=null;state.space=null;state.members=[];state.meals=[];render()}});
}
async function loadWorkspace(){state.space=null;state.members=[];state.meals=[];if(!state.session)return;
 const uid=state.session.user.id;
 const {data:rows,error}=await client.from('memberships').select('space_id, slot, display_name, daily_goal, user_id').eq('user_id',uid).limit(1);
 if(error)throw error;
 if(!rows?.length)return;
 const {data:space,error:se}=await client.from('spaces').select('*').eq('id',rows[0].space_id).single();if(se)throw se;
 state.space=space;
 const {data:people,error:pe}=await client.from('memberships').select('space_id, slot, display_name, daily_goal, user_id').eq('space_id',space.id);if(pe)throw pe;
 state.members=people;
 await loadMeals();setupRealtime();
}
let realtimeChannel=null;
function setupRealtime(){if(!client||!state.space)return;
 if(realtimeChannel){client.removeChannel(realtimeChannel);realtimeChannel=null}
 realtimeChannel=client.channel('meal-updates-'+state.space.id).on('postgres_changes',{event:'*',schema:'public',table:'meals',filter:`space_id=eq.${state.space.id}`},()=>loadMeals().then(render).catch(()=>{})).subscribe();
}
async function loadMeals(){if(state.demo)return;
 const {data,error}=await client.from('meals').select('*').eq('space_id',state.space.id).gte('day',shiftDate(state.date,-45)).lte('day',shiftDate(state.date,15)).order('created_at',{ascending:false}).limit(500);
 if(error)throw error;state.meals=data||[];
 const paths=[...new Set(state.meals.flatMap(mealPhotos).filter(Boolean))];
 await Promise.all(paths.map(async path=>{if(state.imageUrls[path])return;const {data,error}=await client.storage.from('meal-photos').createSignedUrl(path,3600);if(!error&&data?.signedUrl)state.imageUrls[path]=data.signedUrl}));
}
async function changeDay(day){if(!/^\d{4}-\d{2}-\d{2}$/.test(day))return;state.date=day;if(!state.demo&&state.space){try{await loadMeals()}catch(e){toast(friendlyError(e))}}render()}
function alertBanner(){if(state.demo)return `<div class="banner banner-demo"><b>預覽模式</b>：目前紀錄只存在這個瀏覽器，尚未連接雙人共用雲端與 AI。依照 README 設定 Supabase、OpenAI 與 Vercel 後即可啟用。</div>`;return state.notice?`<div class="banner banner-error">${escapeHtml(state.notice)}</div>`:''}
function topbar(){const names=orderedMembers();return `<div class="topbar"><div class="brand"><span class="brand-icon">◒</span><span>Daily Plate<span class="brand-sub">FOOD JOURNAL</span></span></div><div class="top-actions">${state.space?`<button class="btn btn-outline btn-small btn-hide-mobile" data-action="show-space">共用代碼</button>`:''}<button class="btn btn-outline btn-small install-trigger" data-action="show-install" aria-label="安裝到手機主畫面" title="加入手機主畫面">⌂ <span>加入手機</span></button><div class="avatar-pair">${names.map((m,i)=>`<span class="avatar" title="${escapeHtml(m.display_name)}">${escapeHtml((m.display_name||'?').slice(0,1))}</span>`).join('')}</div>${state.demo?'':`<button class="quiet" data-action="signout">登出</button>`}</div></div>`}
function renderAuth(){app.innerHTML=`<div class="layout"><div class="auth-wrap"><div class="brand"><span class="brand-icon">◒</span><span>Daily Plate</span></div>${alertBanner()}<div class="auth-panel"><p class="eyebrow">SHARED FOOD JOURNAL</p><h1>${state.authMode==='login'?'歡迎回來':'建立你的帳號'}</h1><p>每天拍照記錄飲食，與另一個人共用完整熱量日記。</p><form id="auth-form"><div class="field"><label>電子郵件</label><input name="email" type="email" autocomplete="email" required placeholder="you@example.com"></div><div class="field"><label>密碼</label><input name="password" type="password" minlength="6" required placeholder="至少 6 碼" autocomplete="${state.authMode==='login'?'current-password':'new-password'}"></div><button class="btn btn-primary fill" type="submit">${state.authMode==='login'?'登入':'註冊'}</button></form><div class="toggle-line">${state.authMode==='login'?'還沒有帳號？':'已經有帳號？'} <button class="quiet" data-action="toggle-auth">${state.authMode==='login'?'建立帳號':'返回登入'}</button></div></div><p style="font-size:12px;text-align:center;margin-top:21px">照片只對同一個共用空間內的成員開放。</p></div></div>`}
function renderWorkspace(){app.innerHTML=`<div class="layout">${topbar()}<div class="workspace-panel">${alertBanner()}<p class="eyebrow">SET UP YOUR SHARED SPACE</p><h1>開始記錄每一餐。</h1><p>建立空間後就能自己記餐，也可分享邀請碼，讓另一人加入同一份飲食日記。</p><div class="workspace-options"><div class="workspace-box"><h2>建立個人空間</h2><p>給自己取個稱呼，就可以開始記餐。</p><form id="create-space-form"><div class="field"><label>你的稱呼</label><input name="nickname" value="我" maxlength="24" required></div><div class="field"><label>空間名稱</label><input name="spaceName" value="我們的餐桌" maxlength="40" required></div><button class="btn btn-primary fill" type="submit">建立雙人空間</button></form></div><div class="workspace-box"><h2>加入已有空間</h2><p>請對方分享邀請碼，輸入後即可一起紀錄。</p><form id="join-space-form"><div class="field"><label>你的稱呼</label><input name="nickname" value="他" maxlength="24" required></div><div class="field"><label>8 碼邀請碼</label><input name="invite" class="code" maxlength="8" minlength="8" required placeholder="例如 A1B2C3D4" autocapitalize="characters"></div><button class="btn btn-outline fill" type="submit">加入空間</button></form></div></div></div></div>`}
function summaryCard(member,i){const t=personTotals(mealsOnDay(),member.user_id),goal=n(member.daily_goal),p=goal?Math.min(100,Math.round(t.kcal/goal*100)):0;return `<div class="summary-card"><div class="card-top"><span class="person-dot ${i?'p1':''}">${escapeHtml((member.display_name||'?').slice(0,1))}</span>${escapeHtml(member.display_name||'成員')} <button class="quiet" data-action="goal" data-user="${member.user_id}" style="margin-left:auto">設定目標</button></div><div class="stat-line"><span class="stat-big">${whole(t.kcal)}</span><span class="unit">kcal 已攝取</span></div><p class="goal-meta">${goal?`每日目標 ${whole(goal)} kcal・${t.kcal>goal?`超出 ${whole(t.kcal-goal)}`:`剩餘 ${whole(goal-t.kcal)}`} kcal`:'尚未設定每日熱量目標'}</p><div class="progress"><div class="progress-fill ${i?'warm':''}" style="width:${p}%"></div></div><div class="macro-line"><span>蛋白質 <b>${fixed(t.protein)}g</b></span><span>碳水 <b>${fixed(t.carbs)}g</b></span><span>脂肪 <b>${fixed(t.fat)}g</b></span></div></div>`}
function mealPhotos(meal){
  return [meal.image_path,...(Array.isArray(meal.estimate_meta?.extraPhotos)?meal.estimate_meta.extraPhotos:[])].filter(Boolean);
}
function photoSource(path){return state.demo||path.startsWith('data:')?path:state.imageUrls[path]}
function mealPhoto(meal){
  const sources=mealPhotos(meal).map(photoSource).filter(Boolean);
  return sources.length?`<div class="meal-photo-strip">${sources.map(src=>`<img class="meal-pic" alt="餐點照片" loading="lazy" src="${escapeHtml(src)}">`).join('')}</div>`:'';
}
function mealCard(meal){const t=personTotals([meal],state.members[0].user_id),m2=state.members[1],t2=m2?personTotals([meal],m2.user_id):null;const title=(meal.items||[]).map(x=>x.name).filter(Boolean).slice(0,3).join('、')||'餐點';return `<article class="meal-card">${mealPhoto(meal)}<div class="meal-content"><div class="meal-overline">${mealEmoji(meal.meal_type)} ${mealNames(meal.meal_type)} · ${meal.items?.length||0} 項</div><h3>${escapeHtml(title)}</h3><p class="note">${escapeHtml(meal.note||'已記錄這一餐')}</p><div class="meal-kcals"><span>${escapeHtml(state.members[0].display_name)} <b>${whole(t.kcal)} kcal</b></span>${m2?`<span>${escapeHtml(m2.display_name)} <b>${whole(t2.kcal)} kcal</b></span>`:''}</div></div><button class="meal-action" data-action="edit-meal" data-id="${meal.id}" aria-label="修改餐點">✎</button></article>`}
function chart(){const days=Array.from({length:7},(_,i)=>shiftDate(state.date,i-6));const values=days.map(day=>state.members.map(m=>personTotals(state.meals.filter(e=>e.day===day),m.user_id).kcal));const max=Math.max(1200,...values.flat());return `<div class="side-card"><h3>最近 7 天</h3><div class="chart">${days.map((day,i)=>`<div class="bar-col"><div class="bar-track" style="display:flex;align-items:end;gap:2px;background:transparent;max-width:36px"><div class="bar-fill ${day===state.date?'current':''}" style="width:50%;height:${Math.round(values[i][0]/max*100)}%"></div><div class="bar-fill" style="width:50%;height:${Math.round((values[i][1]||0)/max*100)}%;background:#ebb88a"></div></div><span class="bar-label">${day.slice(5).replace('-','/')}</span></div>`).join('')}</div><p class="chart-info"><span style="color:#398b63">●</span> ${escapeHtml(state.members[0]?.display_name||'我')}　<span style="color:#ebb88a">●</span> ${escapeHtml(state.members[1]?.display_name||'他')}　· 各日已紀錄熱量</p></div>`}
function mobileNav(today,yesterday){
 const links=[['today','首頁',today],['add-meal','＋ 上傳'],['records','記錄'],['settings','設定']];
 return `<nav class="mobile-nav journal-nav" aria-label="日記導覽">${links.map(([action,label,date])=>`<button class="nav-button ${date===state.date?'active':''}" data-action="${action}">${label}</button>`).join('')}</nav>`;
}
function renderDashboard(){
  const today=dateKey(new Date()), yesterday=shiftDate(today,-1), meals=mealsOnDay();
  app.innerHTML=`<main class="layout compact-dashboard">
    <header class="journal-header"><div><h1>FOOD JOURNAL</h1></div>
      <label class="date-pill"><input id="date-control" aria-label="選擇紀錄日期" type="date" value="${state.date}"></label></header>
    ${state.demo?'<p class="tiny">預覽模式 · 資料儲存在此瀏覽器</p>':state.notice?alertBanner():''}
    <section aria-label="每日攝取"><div class="section-title"><h2>每日攝取</h2></div>
      <div class="summary-grid">${orderedMembers().map(summaryCard).join('')}</div></section>
    <section id="meal-section"><div class="section-title"><h2>餐點紀錄</h2><small>${meals.length} 筆</small></div>
      <div class="meal-list">${meals.length?meals.map(mealCard).join(''):'<p class="compact-empty">這天還沒有餐點紀錄。</p>'}</div></section>
    </main>${mobileNav(today,yesterday)}${state.modal?renderModal():''}`;
}
function render(){const previousModalScroll=document.querySelector('.modal')?.scrollTop||0;document.body.classList.toggle('dialog-open',Boolean(state.modal));if(!state.demo&&!state.session){renderAuth();return}if(!state.demo&&!state.space){renderWorkspace();return}renderDashboard();const updatedModal=document.querySelector('.modal');if(updatedModal)updatedModal.scrollTop=previousModalScroll}
function openNewForm(meal){const editing=!!meal;state.currentForm={id:meal?.id||null,day:meal?.day||state.date,meal_type:meal?.meal_type||mealTypeAt(new Date()),note:meal?.note||'',restaurant:meal?.restaurant||'',photos:meal?mealPhotos(meal):[],originalPhotos:meal?mealPhotos(meal):[],image_path:meal?.image_path||null,original_image_path:meal?.image_path||null,items:editing?structuredClone(meal.items||[]):[defaultItem()],estimated:meal?.estimate_meta||null};state.modal='meal';render()}
function formItem(i,item){const people=orderedMembers();return `<div class="editor-item" data-item="${i}"><div class="editor-top"><input aria-label="食物名稱" data-field="name" data-index="${i}" value="${escapeHtml(item.name)}" placeholder="食物名稱"><button class="quiet" data-action="remove-item" data-index="${i}">移除</button></div><div class="mini-grid">${[['kcal','熱量 kcal'],['protein_g','蛋白質 g'],['carbs_g','碳水 g'],['fat_g','脂肪 g']].map(([field,label])=>`<label>${label}<input type="number" min="0" step="0.1" data-field="${field}" data-index="${i}" value="${n(item[field])}"></label>`).join('')}</div><div class="split-grid">${people.map(p=>`<label>${people.length>1?`<strong class="portion-person">${escapeHtml(p.display_name)}</strong>`:''}吃了多少%<input type="number" inputmode="numeric" min="0" max="100" data-share-user="${p.user_id}" data-index="${i}" value="${Math.round(safePercent(item.shares?.[p.user_id]||0))}"></label>`).join('')}</div>${item.portion?`<div class="tiny">AI 推估份量：${escapeHtml(item.portion)}</div>`:''}<div class="tiny">食用百分比合計不可超過 100%；未分配的部分視為剩餘食物。</div></div>`}
let deferredInstallPrompt=null;
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();deferredInstallPrompt=event});
window.addEventListener('appinstalled',()=>{deferredInstallPrompt=null;toast('已加入手機主畫面')});
function renderModal(){if(state.modal==='settings')return settingsModal();if(state.modal==='profile')return profileModal();if(state.modal==='records')return recordsModal();if(state.modal==='install'){const standalone=window.matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;const ios=/iphone|ipad|ipod/i.test(navigator.userAgent);return `<div class="modal-backdrop"><div class="modal settings-panel" role="dialog" aria-modal="true" aria-label="安裝手機 App"><div class="modal-head"><div><p class="eyebrow">DAILY PLATE ON YOUR PHONE</p><h2>加入手機主畫面</h2></div><button class="x" data-action="close-modal" aria-label="關閉">×</button></div>${standalone?'<p>你已經從手機主畫面開啟 Daily Plate。</p>':ios?'<p>在 <b>Safari</b> 開啟網站，點下方「分享」圖示，選擇 <b>加入主畫面</b>，再點「加入」。</p>':'<p>在 <b>Chrome</b> 開啟網站，點選右上角選單，再選擇 <b>安裝應用程式</b> 或 <b>加入主畫面</b>。</p>'}${!standalone&&deferredInstallPrompt?'<button class="btn btn-primary fill" data-action="native-install">直接安裝</button>':''}<div class="hint-card" style="margin-top:18px"><b>使用前須先部署</b>必須先有 HTTPS 網站網址。安裝到主畫面不會自動啟用雙人同步或 AI；這兩項仍需完成雲端設定。</div></div></div>`}
 if(state.modal==='space'){return `<div class="modal-backdrop" id="modal-backdrop"><div class="modal settings-panel"><div class="modal-head"><div><p class="eyebrow">SHARED WORKSPACE</p><h2>雙人空間設定</h2></div><button class="x" data-action="close-modal">×</button></div><p>把下方邀請碼傳給另一位，他註冊並加入後就能共同使用。</p><div class="split-preview" style="justify-content:space-between"><span class="code">${escapeHtml(state.space?.invite_code||'')}</span><button class="btn btn-outline btn-small" data-action="copy-code">複製邀請碼</button></div><p class="tiny">邀請碼請只分享給你信任的人。每個空間最多兩位成員。</p><div class="section-title"><h3>空間成員</h3></div>${state.members.map(m=>`<div style="display:flex;justify-content:space-between;margin:7px 0"><span>${escapeHtml(m.display_name)}</span><span class="tiny">${m.user_id===currentUserId()?'你':'另一位成員'}</span></div>`).join('')}</div></div>`}
 if(state.modal!=='meal')return '';
 const f=state.currentForm;const sums=orderedMembers().map(m=>({member:m,total:personTotals([{items:f.items}],m.user_id)}));
 return `<div class="modal-backdrop" id="modal-backdrop"><div class="modal meal-editor" role="dialog" aria-modal="true" aria-label="餐點編輯"><div class="meal-editor-body"><div class="modal-head"><div><p class="eyebrow">${f.id?'EDIT YOUR MEAL':'ADD A NEW MEAL'}</p><h2>${f.id?'修改這餐':'記錄一餐'}</h2></div><button class="x" data-action="close-modal">×</button></div><div class="field"><label>餐點照片</label><div class="photo-box">${f.photos.length?`<div class="meal-photo-grid">${f.photos.map((path,i)=>`<div>${photoSource(path)?`<img class="upload-preview" src="${escapeHtml(photoSource(path))}" alt="餐點照片 ${i+1}">`:''}<button class="quiet" data-action="remove-photo" data-index="${i}">移除照片 ${i+1}</button></div>`).join('')}</div>`:'<p>可加入最多 6 張照片</p>'}<div class="photo-buttons"><label class="photo-option photo-camera"><span aria-hidden="true">◉</span><span>開啟相機</span><input id="photo-camera" type="file" accept="image/*" capture="environment"></label><label class="photo-option photo-gallery"><span aria-hidden="true">▣</span><span>從相簿選擇</span><input id="photo-gallery" type="file" multiple accept="image/*"></label></div></div></div><div class="field"><label>補充說明</label><input id="form-note" maxlength="500" value="${escapeHtml(f.note)}" placeholder="例如：飯只吃一半、飲料有糖"></div><div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><button class="btn btn-soft" data-action="analyze" ${!f.photos.length?'disabled':''}>分析餐點</button>${f.estimated?.min_kcal!=null?`<span class="estimate-pill">推估範圍 ${whole(f.estimated.min_kcal)}–${whole(f.estimated.max_kcal)} kcal</span>`:''}</div>${f.estimated?.assumption?`<p style="font-size:12px;margin:8px 0">估算假設：${escapeHtml(f.estimated.assumption)}</p>`:''}<div class="form-grid"><div class="field"><label>用餐日期</label><input id="form-date" type="date" value="${f.day}"></div><div class="field"><label>餐別</label><select id="form-type">${['breakfast','lunch','dinner','snack'].map(t=>`<option value="${t}" ${t===f.meal_type?'selected':''}>${mealNames(t)}</option>`).join('')}</select></div></div><div class="form-grid"><div class="field"><label>用餐地點（選填）</label><input id="form-restaurant" maxlength="100" value="${escapeHtml(f.restaurant)}" placeholder="餐廳、家裡或地址"><button class="btn btn-outline btn-small" data-action="locate">使用目前位置</button></div></div><hr class="divider"><div class="section-title" style="margin-top:0"><h3>食物與熱量明細</h3><button class="btn btn-outline btn-small" data-action="add-item">＋ 新增一項</button></div><p class="tiny" style="margin-top:-8px">每一項食物的總熱量先填在左邊，再分配各自實際吃掉的百分比。</p>${f.items.map((item,i)=>formItem(i,item)).join('')||'<p>請新增至少一項食物。</p>'}<div class="split-preview">${sums.map(({member,total})=>`<span>${escapeHtml(member.display_name)}：${whole(total.kcal)} kcal</span>`).join('')}</div></div><div class="modal-actions">${f.id?`<button class="btn btn-danger" data-action="delete-meal">刪除紀錄</button>`:'<span></span>'}<div style="display:flex;gap:8px"><button class="btn btn-outline" data-action="close-modal">取消</button><button class="btn btn-primary" data-action="save-meal">儲存這一餐</button></div></div></div></div>`}
function collectFormBasic(){const f=state.currentForm;if(!f)return;f.day=$('form-date')?.value||f.day;f.meal_type=$('form-type')?.value||f.meal_type;f.restaurant=$('form-restaurant')?.value||'';f.note=$('form-note')?.value||''}
async function photoToDataUrl(file){if(!file.type.startsWith('image/'))throw new Error('請選擇圖片檔案');if(file.size>20*1024*1024)throw new Error('原始照片不可超過 20MB');
 const objectUrl=URL.createObjectURL(file);const img=new Image();try{img.src=objectUrl;await img.decode();}catch{URL.revokeObjectURL(objectUrl);throw new Error('無法讀取照片，請改用 JPG、PNG 或 WebP 格式。')}
 let maxSide=1280,quality=.76,result='';for(let attempt=0;attempt<4;attempt++){const scale=Math.min(1,maxSide/Math.max(img.naturalWidth,img.naturalHeight));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);result=canvas.toDataURL('image/jpeg',quality);if(result.length<600000)break;maxSide=Math.round(maxSide*.75);quality-=.08}
 URL.revokeObjectURL(objectUrl);if(result.length>=650000)throw new Error('照片仍然太大，請使用較小的照片');return result}
async function estimatePhoto(){const f=state.currentForm;collectFormBasic();if(!f.photos.length)return toast('請先選擇照片');
 if(state.demo)return toast('預覽模式可手動輸入熱量');
 setBusy(true);try{
 const {data:{session}}=await client.auth.getSession();if(!session)throw new Error('登入已過期，請重新登入');
 const images=[];
 for(const path of f.photos){
   if(path.startsWith('data:')){images.push(path);continue}
   const source=photoSource(path);
   if(!source)throw new Error('無法載入原餐點照片');
   const response=await fetch(source);
   if(!response.ok)throw new Error('無法載入原餐點照片');
   images.push(await blobToDataURL(await response.blob()));
 }
 if(images.reduce((sum,image)=>sum+image.length,0)>4000000)throw new Error('照片總容量太大，請減少張數再分析');
 const payload={images,notes:f.note};
 const resp=await fetch('/api/analyze',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`},body:JSON.stringify(payload)});
 const data=await resp.json().catch(()=>({}));if(resp.status===503)throw new Error('餐點分析尚未啟用，可先手動填寫並儲存');if(!resp.ok)throw new Error(data.error||`分析失敗 (${resp.status})`);
 f.items=(data.items||[]).map(item=>defaultItem(item.name,item.kcal,item.protein_g,item.carbs_g,item.fat_g,item.portion));if(!f.items.length)f.items=[defaultItem('請填寫餐點熱量')];f.estimated={min_kcal:data.min_kcal,max_kcal:data.max_kcal,assumption:data.assumption,confidence:data.confidence};toast('已完成初步估算，請確認份量');render();
 }catch(e){toast(friendlyError(e))}finally{setBusy(false)}}
function blobToDataURL(blob){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob)})}
async function uploadPhoto(dataUrl){const blob=await fetch(dataUrl).then(r=>r.blob());const path=`${state.space.id}/${newUUID()}.jpg`;const {error}=await client.storage.from('meal-photos').upload(path,blob,{contentType:'image/jpeg',upsert:false,cacheControl:'3600'});if(error)throw error;return path}
async function saveMeal(){collectFormBasic();const f=state.currentForm;if(!f.items.length)return toast('請至少新增一項食物');if(!f.items.every(item=>n(item.kcal)>=0&&Object.values(item.shares||{}).reduce((a,b)=>a+safePercent(b),0)<=100.001))return toast('每項食物的分食比例總和不可超過 100%');
 setBusy(true);const uploaded=[];let committed=false;try{
 const paths=[];
 for(const photo of f.photos){
   if(state.demo||!photo.startsWith('data:')){paths.push(photo);continue}
   const path=await uploadPhoto(photo);uploaded.push(path);paths.push(path);
 }
 const meal={day:f.day,meal_type:f.meal_type,note:f.note,restaurant:f.restaurant,image_path:paths[0]||null,items:f.items,estimate_meta:{...f.estimated,extraPhotos:paths.slice(1)}};
 if(state.demo){if(f.id){const i=state.meals.findIndex(m=>m.id===f.id);if(i>=0)state.meals[i]={...state.meals[i],...meal}}else state.meals.unshift({...meal,id:newUUID(),created_at:new Date().toISOString(),created_by:currentUserId(),space_id:'demo'});demoWrite()}
 else{let response;if(f.id)response=await client.from('meals').update(meal).eq('id',f.id).eq('space_id',state.space.id);else response=await client.from('meals').insert({...meal,space_id:state.space.id,created_by:currentUserId()});if(response.error)throw response.error;committed=true;state.date=f.day;
 try{await loadMeals()}catch{state.modal=null;state.currentForm=null;render();return toast('已儲存到雲端，請重新整理以載入餐點')}}
 if(!state.demo){const removed=f.originalPhotos.filter(path=>!paths.includes(path));if(removed.length)await client.storage.from('meal-photos').remove(removed)}
 state.modal=null;state.currentForm=null;state.date=f.day;render();toast('餐點已儲存');
 }catch(e){if(uploaded.length&&!committed)await client.storage.from('meal-photos').remove(uploaded).catch(()=>{});toast(friendlyError(e))}finally{setBusy(false)}}
async function deleteMeal(){const f=state.currentForm;if(!f?.id||!confirm('確定要刪除這筆餐點紀錄嗎？'))return;setBusy(true);try{if(state.demo){state.meals=state.meals.filter(m=>m.id!==f.id);demoWrite()}else{const {error}=await client.from('meals').delete().eq('id',f.id).eq('space_id',state.space.id);if(error)throw error;await loadMeals();if(f.originalPhotos.length)await client.storage.from('meal-photos').remove(f.originalPhotos)}state.modal=null;state.currentForm=null;render();toast('已刪除餐點')}catch(e){toast(friendlyError(e))}finally{setBusy(false)}}
async function authSubmit(form){const fd=new FormData(form),email=String(fd.get('email')).trim(),password=String(fd.get('password'));setBusy(true);try{if(state.authMode==='login'){const {data,error}=await client.auth.signInWithPassword({email,password});if(error)throw error;state.session=data.session;await loadWorkspace();state.notice='';render()}else{const {data,error}=await client.auth.signUp({email,password});if(error)throw error;if(data.session){state.session=data.session;await loadWorkspace();render()}else toast('註冊完成，請到信箱點擊驗證連結，之後再登入')}}catch(e){toast(friendlyError(e))}finally{setBusy(false)}}
async function spaceSubmit(form,isCreate){const fd=new FormData(form);const nickname=String(fd.get('nickname')||'').trim();setBusy(true);try{let response;if(isCreate)response=await client.rpc('create_shared_space',{p_space_name:String(fd.get('spaceName')||'我們的餐桌'),p_display_name:nickname});else response=await client.rpc('join_shared_space',{p_invite_code:String(fd.get('invite')||'').trim().toUpperCase(),p_display_name:nickname});if(response.error)throw response.error;await loadWorkspace();render();toast(isCreate?'已建立雙人空間，請分享邀請碼':'已加入雙人空間')}catch(e){toast(friendlyError(e))}finally{setBusy(false)}}
async function setGoal(user){const member=state.members.find(m=>m.user_id===user);if(!member)return;if(!state.demo&&user!==currentUserId())return toast('每個人只能修改自己的目標');const input=prompt(`每日熱量目標(kcal)\n留空可取消目標`,member.daily_goal||'');if(input===null)return;const val=input.trim()===''?null:Math.round(n(input));if(val!==null&&(val<500||val>10000))return toast('請輸入 500～10,000 kcal，或留空取消');
 if(state.demo){member.daily_goal=val;try{localStorage.setItem('daily-plate-demo-goals',JSON.stringify(Object.fromEntries(state.members.map(m=>[m.user_id,m.daily_goal]))))}catch{}render();return}setBusy(true);try{const {error}=await client.from('memberships').update({daily_goal:val}).eq('user_id',user).eq('space_id',state.space.id);if(error)throw error;member.daily_goal=val;render();toast('每日目標已更新')}catch(e){toast(friendlyError(e))}finally{setBusy(false)}}
document.addEventListener('submit',async e=>{if(e.target.id==='profile-form'){e.preventDefault();saveProfile(e.target)}if(e.target.id==='auth-form'){e.preventDefault();await authSubmit(e.target)}if(e.target.id==='create-space-form'){e.preventDefault();await spaceSubmit(e.target,true)}if(e.target.id==='join-space-form'){e.preventDefault();await spaceSubmit(e.target,false)}});
document.addEventListener('click',async e=>{const el=e.target.closest('[data-action]');if(!el)return;const action=el.dataset.action;
 if(action==='toggle-auth'){state.authMode=state.authMode==='login'?'signup':'login';render()}
 else if(action==='signout'){await client.auth.signOut();state.session=null;state.space=null;state.modal=null;render()}
 else if(action==='prev-day')await changeDay(shiftDate(state.date,-1));
 else if(action==='next-day')await changeDay(shiftDate(state.date,1));
 else if(action==='today')await changeDay(dateKey(new Date()));
 else if(action==='yesterday')await changeDay(shiftDate(dateKey(new Date()),-1));
 else if(action==='add-meal')openNewForm(null);
 else if(['records','profile','settings'].includes(action)){state.modal=action;render()}
 else if(action==='history-day')await changeDay(el.dataset.day);
 else if(action==='record-tab'){state.recordTab=el.dataset.tab;render()}
 else if(action==='locate')fillLocation();
 else if(action==='demo-mode'&&state.demo){
   const solo=state.members.length>1;
   localStorage.setItem('daily-plate-solo',String(solo));
   state.members=solo?state.members.slice(0,1):[state.members[0],structuredClone(demoPeople[1])];
   render();
 }
 else if(action==='show-install'){state.modal='install';render()}
 else if(action==='native-install'&&deferredInstallPrompt){const install=deferredInstallPrompt;deferredInstallPrompt=null;install.prompt();await install.userChoice.catch(()=>{});state.modal=null;render()}
 else if(action==='edit-meal'){const meal=state.meals.find(m=>m.id===el.dataset.id);if(meal)openNewForm(meal)}
 else if(action==='close-modal'){state.modal=null;state.currentForm=null;render()}
 else if(action==='show-space'){state.modal='space';render()}
 else if(action==='copy-code'){try{await navigator.clipboard.writeText(state.space.invite_code);toast('邀請碼已複製')}catch{toast('無法自動複製，請手動選取邀請碼')}}
 else if(action==='goal')await setGoal(el.dataset.user);
 else if(action==='remove-photo'){collectFormBasic();state.currentForm.photos.splice(Number(el.dataset.index),1);render()}
 else if(action==='analyze')await estimatePhoto();
 else if(action==='add-item'){collectFormBasic();state.currentForm.items.push(defaultItem());render()}
 else if(action==='remove-item'){collectFormBasic();state.currentForm.items.splice(Number(el.dataset.index),1);render()}
 else if(action==='save-meal')await saveMeal();
 else if(action==='delete-meal')await deleteMeal();
});
document.addEventListener('change',async e=>{if(e.target.id==='date-control'||e.target.id==='record-date')await changeDay(e.target.value);
 if(e.target.id==='form-date'&&state.currentForm)state.currentForm.dateEdited=true;
 if(e.target.id==='form-type'&&state.currentForm)state.currentForm.mealTypeEdited=true;
 if(['photo-camera','photo-gallery'].includes(e.target.id)){
   const files=Array.from(e.target.files||[]);
   const form=state.currentForm;
   if(!form||!files.length)return;
   if(form.photos.length+files.length>6){e.target.value='';return toast('每餐最多 6 張照片')}
   collectFormBasic();setBusy(true);
   try{
     const photos=[];
     for(const file of files)photos.push(await photoToDataUrl(file));
     if(!form.id&&!form.photos.length){
       const taken=await photoDate(files[0],e.target.id==='photo-camera');
       if(taken&&!form.dateEdited)form.day=dateKey(taken);
       if(!form.mealTypeEdited)form.meal_type=mealTypeAt(taken||new Date());
     }
     form.photos.push(...photos);form.estimated=null;render();
   }catch(err){toast(friendlyError(err))}finally{setBusy(false)}
 }
 if(!state.currentForm)return;
 if(e.target.matches('[data-field]')){collectFormBasic();const item=state.currentForm.items[Number(e.target.dataset.index)];if(!item)return;const field=e.target.dataset.field;item[field]=field==='name'?e.target.value:Math.max(0,n(e.target.value));refreshMealTotals()}
 if(e.target.matches('[data-share-user]')){collectFormBasic();const item=state.currentForm.items[Number(e.target.dataset.index)],id=e.target.dataset.shareUser;if(!item)return;item.shares??={};let target=safePercent(e.target.value);item.shares[id]=target;const other=state.members.find(m=>m.user_id!==id);if(other&&target+safePercent(item.shares[other.user_id])>100){
   item.shares[other.user_id]=100-target;
   const otherInput=e.target.closest('.split-grid').querySelector(`[data-share-user="${other.user_id}"]`);
   if(otherInput)otherInput.value=100-target;
 }e.target.value=target;refreshMealTotals()}
});

function refreshMealTotals(){
  const preview=document.querySelector('.meal-editor .split-preview');
  if(!preview)return;
  orderedMembers().forEach((member,index)=>{
    const total=personTotals([state.currentForm],member.user_id).kcal;
    preview.children[index].textContent=`${member.display_name}：${whole(total)} kcal`;
  });
}

function mealTypeAt(date) {
  const hour = date.getHours();
  if (hour >= 5 && hour < 11) return 'breakfast';
  if (hour >= 11 && hour < 15) return 'lunch';
  if (hour >= 17 && hour < 22) return 'dinner';
  return 'snack';
}

async function photoDate(file, camera) {
  if (camera) return new Date();
  const header = new TextDecoder('latin1').decode(await file.slice(0, 262144).arrayBuffer());
  const exif = header.indexOf('Exif\0\0');
  const stamp = exif < 0 ? null : header.slice(exif, exif + 65536).match(/(20\d{2}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
  if (!stamp) return null;
  const [year,month,day,hour,minute,second] = stamp.slice(1).map(Number);
  const date = new Date(year,month-1,day,hour,minute,second);
  return date.getMonth()===month-1 && date.getDate()===day ? date : null;
}

function fillLocation() {
  if (!navigator.geolocation) return toast('無法定位，請手動輸入地點');
  const form = state.currentForm;
  const original = $('form-restaurant').value;
  navigator.geolocation.getCurrentPosition(({coords}) => {
    const field = $('form-restaurant');
    if (state.currentForm !== form || !field || field.value !== original) return;
    field.value = `${coords.latitude.toFixed(4)}, ${coords.longitude.toFixed(4)}`;
    collectFormBasic();
    toast('已填入目前位置，可改成餐廳名稱');
  }, () => toast('無法取得定位，請手動輸入用餐地點'), {timeout:10000});
}

const activityOptions = [[1.2,'久坐'],[1.375,'輕度'],[1.55,'中度'],[1.725,'高度'],[1.9,'非常活躍']];
function profileKey(){return `daily-plate-profile-${currentUserId()}`}
function readProfile(){
  try{return JSON.parse(localStorage.getItem(profileKey()))||{}}catch{return {}}
}
function dailyExpenditure(p){
  if(!p.height||!p.weight||!p.age||!p.sex||!p.activity)return null;
  const resting=10*p.weight+6.25*p.height-5*p.age+(p.sex==='male'?5:-161);
  return Math.round(resting*p.activity);
}
function journalModal(title,html){
  return `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-label="${title}"><div class="modal-head"><h2>${title}</h2><button class="x" data-action="close-modal" aria-label="關閉">×</button></div>${html}</section></div>`;
}
function settingsModal(){
  const options=[
    ['profile','身高、體重與活動量'],
    ['goal','每日熱量目標(kcal)',currentUserId()],
    state.space?['show-space',state.members.length===1?'單人使用 · 邀請夥伴':'雙人空間']:
      ['demo-mode',state.members.length===1?'切換雙人試用':'切換單人試用'],
    ['show-install','加入手機主畫面']
  ];
  if(state.session)options.push(['signout','登出']);
  return journalModal('設定',`<div class="journal-settings-list">${options.map(([action,label,user])=>
    `<button class="btn btn-outline" data-action="${action}" ${user?`data-user="${user}"`:''}>${label}</button>`).join('')}</div>`);
}

function profileModal(){
  const p=readProfile(), fields=[['height','身高（cm）',80,250,0.1],['weight','體重（kg）',20,400,0.1],['age','年齡',19,120,1]];
  return journalModal('個人資料',`<form id="profile-form"><div class="form-grid">
    ${fields.map(([name,label,min,max,step])=>`<label class="field">${label}<input type="number" name="${name}" min="${min}" max="${max}" step="${step}" value="${n(p[name])||''}" required></label>`).join('')}
    <label class="field">估算公式使用的性別<select name="sex" required><option value="">請選擇</option><option value="female" ${p.sex==='female'?'selected':''}>女性</option><option value="male" ${p.sex==='male'?'selected':''}>男性</option></select></label>
    <label class="field">活動量<select name="activity">${activityOptions.map(([factor,label])=>`<option value="${factor}" ${p.activity===factor?'selected':''}>${label}</option>`).join('')}</select></label></div>
    <p>估計每日消耗 ${dailyExpenditure(p)?whole(dailyExpenditure(p))+' kcal':'—'}</p>
    <p class="tiny">個人資料儲存在目前瀏覽器。</p><button class="btn btn-primary">儲存個人資料</button></form>`);
}
function saveProfile(form){
  const data=new FormData(form);
  const p=Object.fromEntries(['height','weight','age','activity'].map(key=>[key,Number(data.get(key))]));
  p.sex=data.get('sex');
  if(dailyExpenditure(p)<=0)return toast('請確認身高、體重和年齡');
  try{localStorage.setItem(profileKey(),JSON.stringify(p));render();toast('個人資料已儲存')}
  catch{toast('瀏覽器無法儲存個人資料')}
}
function dailyHistory(){
  const user=currentUserId(), goal=n(currentMember()?.daily_goal);
  const days=Array.from({length:7},(_,i)=>shiftDate(state.date,i-6));
  const totals=days.map(day=>personTotals(state.meals.filter(meal=>meal.day===day),user).kcal);
  const max=Math.max(1,goal,...totals);
  return `<section aria-label="最近七天熱量圖表"><h3>最近七天熱量</h3><div class="daily-chart">${days.map((day,i)=>{
    const total=totals[i], excess=goal?Math.max(0,total-goal):0;
    return `<button class="daily-chart-row" data-action="history-day" data-day="${day}">
      <span>${day.slice(5).replace('-','/')}</span><span class="daily-chart-track"><span class="${excess?'over-goal':''}" style="width:${total/max*100}%"></span></span>
      <span>${whole(total)} kcal${excess?` · 超標 ${whole(excess)}`:''}</span></button>`;
  }).join('')}</div></section>`;
}
function recordsModal(){
  const tabs=[['meals','餐點紀錄'],['calories','熱量紀錄'],['deficit','赤字紀錄']];
  const active=state.recordTab||'meals', meals=mealsOnDay(), user=currentUserId();
  const own=meals.filter(meal=>meal.items?.some(item=>getShare(item,user)>0));
  const intake=personTotals(own,user).kcal, expenditure=dailyExpenditure(readProfile()), balance=expenditure-intake;
  const contents={
    meals:dailyHistory()+(meals.length?meals.map(mealCard).join(''):'<p>這天還沒有餐點紀錄。</p>'),
    calories:meals.length?orderedMembers().map(member=>`<p>${escapeHtml(member.display_name)}　${whole(personTotals(meals,member.user_id).kcal)} kcal</p>`).join(''):'<p>這天還沒有熱量紀錄。</p>',
    deficit:!expenditure?'<button class="btn btn-outline" data-action="profile">設定個人資料以估算每日消耗</button>':`<p>估計每日消耗 ${whole(expenditure)} kcal</p>${own.length?`<p>已記錄攝取 ${whole(intake)} kcal</p><p><strong>${balance>=0?'估計赤字':'估計盈餘'} ${whole(Math.abs(balance))} kcal</strong></p><p class="tiny">依目前個人資料與當日已記錄的餐點估算。</p>`:'<p>這天還沒有你的餐點紀錄。</p>'}`
  };
  return journalModal('記錄',`<div class="journal-controls">${tabs.map(([id,label])=>`<button class="btn ${id===active?'btn-primary':'btn-outline'} btn-small" aria-pressed="${id===active}" data-action="record-tab" data-tab="${id}">${label}</button>`).join('')}</div>
  <label class="field">查看日期<input type="date" id="record-date" value="${state.date}"></label><div class="meal-list">${contents[active]}</div>`);
}

boot();
