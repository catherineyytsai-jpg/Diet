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
async function boot(){if(state.demo){state.members=structuredClone(localStorage.getItem('daily-plate-solo')==='true'?demoPeople.slice(0,1):demoPeople);try{const goals=JSON.parse(localStorage.getItem('daily-plate-demo-goals')||'{}');state.members.forEach(m=>m.daily_goal=goals[m.user_id]||null)}catch{}currentMember().display_name=localStorage.getItem('daily-plate-demo-name')||currentMember().display_name;state.meals=demoRead();render();return}
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
 const {data:people,error:pe}=await client.from('memberships').select('*').eq('space_id',space.id);if(pe)throw pe;
 state.members=people;
 await loadMeals();setupRealtime();
}
let realtimeChannel=null;
function setupRealtime(){if(!client||!state.space)return;
 if(realtimeChannel){client.removeChannel(realtimeChannel);realtimeChannel=null}
 realtimeChannel=client.channel('meal-updates-'+state.space.id).on('postgres_changes',{event:'*',schema:'public',table:'meals',filter:`space_id=eq.${state.space.id}`},()=>loadMeals().then(render).catch(()=>{})).subscribe();
}
async function loadMeals(){if(state.demo)return;
 const space=state.space.id, selected=state.date;
 const anchor=state.page==='records'?state.historyEnd||selected:selected;
 const start=shiftDate(selected<anchor?selected:anchor,-89);
 const [year,month]=selected.split('-').map(Number);
 const monthEnd=dateKey(new Date(year,month,0,12));
 const end=anchor>monthEnd?anchor:monthEnd;
 const meals=[];
 const pageSize=500;
 for(let offset=0;;offset+=pageSize){
   const {data,error}=await client.from('meals').select('*').eq('space_id',space)
     .gte('day',start).lte('day',end).order('created_at',{ascending:false}).order('id').range(offset,offset+pageSize-1);
   if(error)throw error;
   meals.push(...data);
   if(data.length<pageSize)break;
 }
 if(state.space?.id!==space||state.date!==selected)return;
 state.meals=meals;
 const paths=[...new Set(mealsOnDay().flatMap(mealPhotos))];
 await Promise.all(paths.map(async path=>{if(state.imageUrls[path])return;const {data,error}=await client.storage.from('meal-photos').createSignedUrl(path,3600);if(!error&&data?.signedUrl)state.imageUrls[path]=data.signedUrl}));
}
async function changeDay(day){if(!/^\d{4}-\d{2}-\d{2}$/.test(day))return;state.date=day;if(!state.demo&&state.space){try{await loadMeals()}catch(e){toast(friendlyError(e))}}render()}
function alertBanner(){if(state.demo)return `<div class="banner banner-demo"><b>預覽模式</b>：目前紀錄只存在這個瀏覽器，尚未連接雙人共用雲端與 AI。依照 README 設定 Supabase、OpenAI 與 Vercel 後即可啟用。</div>`;return state.notice?`<div class="banner banner-error">${escapeHtml(state.notice)}</div>`:''}
function topbar(){const names=orderedMembers();return `<div class="topbar"><div class="brand"><span class="brand-icon">◒</span><span>Daily Plate<span class="brand-sub">FOOD JOURNAL</span></span></div><div class="top-actions">${state.space?`<button class="btn btn-outline btn-small btn-hide-mobile" data-action="show-space">共用代碼</button>`:''}<button class="btn btn-outline btn-small install-trigger" data-action="show-install" aria-label="安裝到手機主畫面" title="加入手機主畫面">⌂ <span>加入手機</span></button><div class="avatar-pair">${names.map((m,i)=>`<span class="avatar" title="${escapeHtml(m.display_name)}">${escapeHtml((m.display_name||'?').slice(0,1))}</span>`).join('')}</div>${state.demo?'':`<button class="quiet" data-action="signout">登出</button>`}</div></div>`}
function renderAuth(){app.innerHTML=`<div class="layout"><div class="auth-wrap"><div class="brand"><span class="brand-icon">◒</span><span>Daily Plate</span></div>${alertBanner()}<div class="auth-panel"><p class="eyebrow">SHARED FOOD JOURNAL</p><h1>${state.authMode==='login'?'歡迎回來':'建立你的帳號'}</h1><p>每天拍照記錄飲食，與另一個人共用完整熱量日記。</p><form id="auth-form"><div class="field"><label>電子郵件</label><input name="email" type="email" autocomplete="email" required placeholder="you@example.com"></div><div class="field"><label>密碼</label><input name="password" type="password" minlength="6" required placeholder="至少 6 碼" autocomplete="${state.authMode==='login'?'current-password':'new-password'}"></div><button class="btn btn-primary fill" type="submit">${state.authMode==='login'?'登入':'註冊'}</button></form><div class="toggle-line">${state.authMode==='login'?'還沒有帳號？':'已經有帳號？'} <button class="quiet" data-action="toggle-auth">${state.authMode==='login'?'建立帳號':'返回登入'}</button></div></div><p style="font-size:12px;text-align:center;margin-top:21px">照片只對同一個共用空間內的成員開放。</p></div></div>`}
function renderWorkspace(){app.innerHTML=`<div class="layout">${topbar()}<div class="workspace-panel">${alertBanner()}<p class="eyebrow">SET UP YOUR SHARED SPACE</p><h1>開始記錄每一餐。</h1><p>建立空間後就能自己記餐，也可分享邀請碼，讓另一人加入同一份飲食日記。</p><div class="workspace-options"><div class="workspace-box"><h2>建立個人空間</h2><p>給自己取個稱呼，就可以開始記餐。</p><form id="create-space-form"><div class="field"><label>你的稱呼</label><input name="nickname" value="我" maxlength="24" required></div><div class="field"><label>空間名稱</label><input name="spaceName" value="我們的餐桌" maxlength="40" required></div><button class="btn btn-primary fill" type="submit">建立雙人空間</button></form></div><div class="workspace-box"><h2>加入已有空間</h2><p>請對方分享邀請碼，輸入後即可一起紀錄。</p><form id="join-space-form"><div class="field"><label>你的稱呼</label><input name="nickname" value="他" maxlength="24" required></div><div class="field"><label>8 碼邀請碼</label><input name="invite" class="code" maxlength="8" minlength="8" required placeholder="例如 A1B2C3D4" autocapitalize="characters"></div><button class="btn btn-outline fill" type="submit">加入空間</button></form></div></div></div></div>`}
function summaryCard(member,i){const t=personTotals(mealsOnDay(),member.user_id),base=n(member.daily_goal),activity=dayActivity(member),extra=n(activity.extraKcal),goal=base?base+extra:0,p=goal?Math.min(100,Math.round(t.kcal/goal*100)):0;return `<div class="summary-card ${member.user_id===currentUserId()?'summary-self':''}"><div class="card-top"><span class="person-dot ${i?'p1':''}">${escapeHtml((member.display_name||'?').slice(0,1))}</span><button class="member-card-link" type="button" data-action="member-view" data-id="${escapeHtml(member.user_id)}" aria-label="查看 ${escapeHtml(member.display_name||'成員')} 的紀錄">${escapeHtml(member.display_name||'成員')}</button> ${member.user_id===currentUserId()?`<button class="quiet" data-action="goal" data-user="${member.user_id}" style="margin-left:auto">設定目標</button>`:''}</div><div class="stat-line"><span class="stat-big">${whole(t.kcal)}</span><span class="unit">kcal 已攝取</span></div><p class="goal-meta">${goal?`${extra?'今日調整後目標':'每日目標'} ${whole(goal)} kcal・${t.kcal>goal?`超出 ${whole(t.kcal-goal)}`:`剩餘 ${whole(goal-t.kcal)}`} kcal`:'尚未設定每日熱量目標'}</p>${goal&&t.kcal>goal?`<p class="goal-warning">超標 ${whole(t.kcal-goal)} kcal</p>`:''}${goal?`<span class="daily-chart-track" aria-hidden="true"><span class="${t.kcal>goal?'over-goal':''}" style="width:${p}%"></span></span>`:''}${activity.steps||extra?`<p class="home-activity">${[activity.steps?`${whole(activity.steps)} 步`:'',extra?`額外運動 ${whole(extra)} kcal`:''].filter(Boolean).join(' · ')}</p>`:''}<div class="macro-line"><span>蛋白質 <b>${fixed(t.protein)}g</b></span><span>碳水 <b>${fixed(t.carbs)}g</b></span><span>脂肪 <b>${fixed(t.fat)}g</b></span></div></div>`}
function mealPhotos(meal){
  return [meal.image_path,...(Array.isArray(meal.estimate_meta?.extraPhotos)?meal.estimate_meta.extraPhotos:[])].filter(Boolean);
}
function photoSource(path){return state.demo||path.startsWith('data:')?path:state.imageUrls[path]}
function mealPhoto(meal){
  const sources=mealPhotos(meal).map(photoSource).filter(Boolean);
  return sources.length?`<div class="meal-gallery"><div class="meal-photo-strip">${sources.map((src,i)=>`<button type="button" data-action="meal-detail" data-id="${meal.id}" aria-label="查看餐點照片 ${i+1}"><img class="meal-pic" alt="餐點照片" loading="lazy" src="${escapeHtml(src)}"></button>`).join('')}</div>${sources.length>1?`<div class="photo-dots" aria-label="${sources.length} 張照片">${sources.map(()=>'<i></i>').join('')}</div>`:''}</div>`:'';
}
function viewedMembers(){
  const people=orderedMembers();
  const selected=people.find(person=>person.user_id===(state.memberView??currentUserId()));
  return selected?[selected]:people;
}
function memberPicker(){
  const people=orderedMembers();
  if(people.length<2)return state.space?'<div class="member-invite"><span>目前只有你加入</span><button class="btn btn-outline btn-small" data-action="show-space">邀請夥伴</button></div>':'';
  const selected=viewedMembers().length===2?'all':viewedMembers()[0]?.user_id;
  return `<div class="journal-controls" role="group" aria-label="選擇要查看的成員">
    ${[['all','兩人'],...people.map(person=>[person.user_id,person.display_name])].map(([id,label])=>
      `<button class="btn btn-small ${selected===id?'btn-primary':'btn-outline'}" aria-pressed="${selected===id}" data-action="member-view" data-id="${escapeHtml(id)}">${escapeHtml(label)}</button>`).join('')}</div>`;
}
function viewedMeals(){
  const meals=mealsOnDay(), people=viewedMembers();
  if(people.length===state.members.length)return meals;
  return meals.filter(meal=>meal.items?.some(item=>getShare(item,people[0].user_id)>0));
}
function mealCard(meal){
  const eaters=orderedMembers().filter(member=>meal.items?.some(item=>getShare(item,member.user_id)>0));
  const ownerLabel=eaters.map(member=>member.display_name).join('、')||'未分配';
  const title=(meal.items||[]).map(item=>item.name).filter(Boolean).slice(0,3).join('、')||'餐點';
  return `<article class="meal-card">${mealPhoto(meal)}<div class="meal-content" data-action="meal-detail" data-id="${meal.id}"><div class="meal-overline">${mealEmoji(meal.meal_type)} ${mealNames(meal.meal_type)} · ${meal.items?.length||0} 項</div><span class="meal-owner">${escapeHtml(ownerLabel)}</span><h3><button class="quiet meal-title" data-action="meal-detail" data-id="${meal.id}">${escapeHtml(title)}</button></h3>${meal.note?`<p class="note">${escapeHtml(meal.note)}</p>`:''}<div class="meal-kcals">${viewedMembers().filter(member=>eaters.includes(member)||eaters.some(eater=>eater.user_id===member.user_id)).map(member=>`<span>${escapeHtml(member.display_name)} <b>${whole(personTotals([meal],member.user_id).kcal)} kcal</b></span>`).join('')}</div></div><button class="meal-action" data-action="edit-meal" data-id="${meal.id}" aria-label="修改餐點">✎</button></article>`;
}
function mobileNav(){
 const links=[['records','記錄','≡'],['home','首頁','⌂'],['add-meal','上傳','＋'],['settings','設定','⚙︎']];
 const active=state.page==='records'?'records':'home';
 return `<nav class="mobile-nav journal-nav" aria-label="日記導覽">${links.map(([action,label,icon])=>`<button class="nav-button ${action===active?'active':''}" data-action="${action}"><span class="nav-symbol" aria-hidden="true">${icon}</span><span>${label}</span></button>`).join('')}</nav>`;
}
function datedHeader(title,id,brand=false){
  return `<header class="journal-header"><h1 class="${brand?'journal-wordmark':''}">${title}</h1>${currentMember()?`<span class="account-circle" aria-label="登入帳號 ${escapeHtml(currentMember().display_name)}" title="${escapeHtml(currentMember().display_name)}">${escapeHtml(currentMember().display_name.slice(0,1))}</span>`: ''}
    ${brand?'':`<div class="journal-date-tools"><div class="date-stepper" role="group" aria-label="日期切換">
    <button type="button" data-action="prev-day" aria-label="前一天">‹</button>
    <label class="date-pill"><span aria-hidden="true">${state.date.replaceAll('-','/')}</span><input id="${id}" aria-label="查看日期" type="date" value="${state.date}"></label>
    <button type="button" data-action="next-day" aria-label="後一天">›</button></div>
    ${state.date!==dateKey(new Date())?'<button class="btn btn-outline btn-small today-shortcut" data-action="today">今天</button>':''}</div>`}</header>`;
}
function renderDashboard(){
  const meals=viewedMeals();
  if(state.page==='records'){app.innerHTML=`${recordsPage()}${mobileNav()}${state.modal?renderModal():''}`;return}
  app.innerHTML=`<main class="layout compact-dashboard">
    ${datedHeader('Daily Plate','date-control',true)}
    ${state.demo?'<p class="tiny">預覽模式 · 資料儲存在此瀏覽器</p>':state.notice?alertBanner():''}
    ${memberPicker()}${monthCalendar()}<section aria-label="每日攝取"><div class="section-title"><h2>每日攝取</h2></div>
      <div class="summary-grid">${viewedMembers().map(summaryCard).join('')}</div></section>
    <section id="meal-section"><div class="section-title"><h2>餐點紀錄</h2><small>${meals.length} 筆</small></div>
      <div class="meal-list">${meals.length?meals.map(mealCard).join(''):'<p class="compact-empty">這天還沒有餐點紀錄。</p>'}</div></section>
    </main>${mobileNav()}${state.modal?renderModal():''}`;
}
function render(){const previousModal=document.querySelector('.modal');const previousModalScroll=previousModal?.scrollTop||0;document.body.classList.toggle('dialog-open',Boolean(state.modal));if(!state.demo&&!state.session){renderAuth();return}if(!state.demo&&!state.space){renderWorkspace();return}renderDashboard();const updatedModal=document.querySelector('.modal');
 if(updatedModal&&state.settingsChild&&['profile','display-name','weekly-activity','goal','space','install'].includes(state.modal)){
   updatedModal.classList.add('journal-sheet','settings-sheet');
   updatedModal.removeAttribute('data-compact-modal');
   updatedModal.querySelector('.modal-head')?.insertAdjacentHTML('afterbegin','<button type="button" class="x" data-action="back-settings" aria-label="返回設定">‹</button>');
 }if(updatedModal){
 if(previousModal?.getAttribute('aria-label')===updatedModal.getAttribute('aria-label'))updatedModal.scrollTop=previousModalScroll;
 if(previousModal?.classList.contains('settings-sheet')&&updatedModal.classList.contains('settings-sheet'))updatedModal.classList.add('sheet-continuation');
}}
function makeMealDraft(meal){const editing=!!meal;return {id:meal?.id||null,day:meal?.day||state.date,meal_type:meal?.meal_type||mealTypeAt(new Date()),note:meal?.note||'',restaurant:meal?.restaurant||'',photos:meal?mealPhotos(meal):[],originalPhotos:meal?mealPhotos(meal):[],image_path:meal?.image_path||null,original_image_path:meal?.image_path||null,items:editing?structuredClone(meal.items||[]):[defaultItem()],originalMeta:meal?.estimate_meta,dailyAdvice:meal?.estimate_meta?.dailyAdvice||'',estimated:meal?.estimate_meta||null}}
function openNewForm(meal){state.photoDrafts=[];state.currentForm=makeMealDraft(meal);state.modal='meal';render()}
function formItem(i,item){const people=orderedMembers();return `<div class="editor-item" data-item="${i}"><div class="editor-top"><input aria-label="食物名稱" data-field="name" data-index="${i}" value="${escapeHtml(item.name)}" placeholder="食物名稱"><button class="quiet" data-action="remove-item" data-index="${i}">移除</button></div><div class="mini-grid">${[['kcal','熱量 kcal'],['protein_g','蛋白質 g'],['carbs_g','碳水 g'],['fat_g','脂肪 g']].map(([field,label])=>`<label>${label}<input type="number" min="0" step="0.1" data-field="${field}" data-index="${i}" value="${n(item[field])}"></label>`).join('')}</div><div class="split-grid">${people.map(p=>`<label>${people.length>1?`<strong class="portion-person">${escapeHtml(p.display_name)}</strong>`:''}吃了多少%<input type="number" inputmode="numeric" min="0" max="100" data-share-user="${p.user_id}" data-index="${i}" value="${Math.round(safePercent(item.shares?.[p.user_id]||0))}"></label>`).join('')}</div>${item.portion?`<div class="tiny">AI 推估份量：${escapeHtml(item.portion)}</div>`:''}<div class="tiny">食用百分比合計不可超過 100%；未分配的部分視為剩餘食物。</div></div>`}
let deferredInstallPrompt=null;
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();deferredInstallPrompt=event});
window.addEventListener('appinstalled',()=>{deferredInstallPrompt=null;toast('已加入手機主畫面')});
function renderModal(){
 if(state.modal==='meal-detail'){
   const meal=state.meals.find(row=>row.id===state.detailMeal);
   if(!meal)return '';
   return journalModal(mealNames(meal.meal_type),`<div class="detail-photos">${mealPhotos(meal).map(photoSource).filter(Boolean).map(src=>`<img src="${escapeHtml(src)}" alt="餐點照片">`).join('')}</div>
   <p>${escapeHtml(meal.restaurant||'')} ${escapeHtml(meal.note||'')}</p><ul>${meal.items.map(item=>`<li>${escapeHtml(item.name)} · ${whole(item.kcal)} kcal</li>`).join('')}</ul>
   <p>${orderedMembers().map(member=>`${escapeHtml(member.display_name)} · ${whole(personTotals([meal],member.user_id).kcal)} kcal`).join(' / ')}</p>
   <button class="btn btn-outline" data-action="edit-meal" data-id="${meal.id}">修改餐點</button>`);
 }
if(state.modal==='weekly-activity')return weeklyActivityModal();if(state.modal==='display-name')return displayNameModal();if(state.modal==='goal')return goalModal();if(state.modal==='settings')return settingsModal();if(state.modal==='profile')return profileModal();if(state.modal==='install'){const standalone=window.matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;const ios=/iphone|ipad|ipod/i.test(navigator.userAgent);return `<div class="modal-backdrop"><div class="modal settings-panel" role="dialog" aria-modal="true" aria-label="安裝手機 App"><div class="modal-head"><div><p class="eyebrow">DAILY PLATE ON YOUR PHONE</p><h2>加入手機主畫面</h2></div><button class="x" data-action="close-modal" aria-label="關閉">×</button></div>${standalone?'<p>你已經從手機主畫面開啟 Daily Plate。</p>':ios?'<p>在 <b>Safari</b> 開啟網站，點下方「分享」圖示，選擇 <b>加入主畫面</b>，再點「加入」。</p>':'<p>在 <b>Chrome</b> 開啟網站，點選右上角選單，再選擇 <b>安裝應用程式</b> 或 <b>加入主畫面</b>。</p>'}${!standalone&&deferredInstallPrompt?'<button class="btn btn-primary fill" data-action="native-install">直接安裝</button>':''}<div class="hint-card" style="margin-top:18px"><b>使用前須先部署</b>必須先有 HTTPS 網站網址。安裝到主畫面不會自動啟用雙人同步或 AI；這兩項仍需完成雲端設定。</div></div></div>`}
 if(state.modal==='space'){return `<div class="modal-backdrop" id="modal-backdrop"><div class="modal settings-panel"><div class="modal-head"><div><p class="eyebrow">SHARED WORKSPACE</p><h2>雙人空間設定</h2></div><button class="x" data-action="close-modal">×</button></div><p>把下方邀請碼傳給另一位，他註冊並加入後就能共同使用。</p><div class="split-preview" style="justify-content:space-between"><span class="code">${escapeHtml(state.space?.invite_code||'')}</span><button class="btn btn-outline btn-small" data-action="copy-code">複製邀請碼</button></div><p class="tiny">邀請碼請只分享給你信任的人。每個空間最多兩位成員。</p><div class="section-title"><h3>空間成員</h3></div>${state.members.map(m=>`<div style="display:flex;justify-content:space-between;margin:7px 0"><span>${escapeHtml(m.display_name)}</span><span class="tiny">${m.user_id===currentUserId()?'你':'另一位成員'}</span></div>`).join('')}</div></div>`}
 if(state.modal!=='meal')return '';
 const f=state.currentForm;const sums=orderedMembers().map(m=>({member:m,total:personTotals([{items:f.items}],m.user_id)}));
 return `<div class="modal-backdrop" id="modal-backdrop"><div class="modal meal-editor journal-sheet" role="dialog" aria-modal="true" aria-label="餐點編輯"><div class="meal-editor-body"><div class="modal-head"><div><h2>${f.id?'修改這餐':'記錄一餐'}</h2></div><button class="x" data-action="close-modal">×</button></div><div class="field"><label>餐點照片</label>${draftNavigation(f)}<div class="photo-box">${f.photos.length?`<div class="meal-photo-grid">${f.photos.map((path,i)=>`<div>${photoSource(path)?`<img class="upload-preview" src="${escapeHtml(photoSource(path))}" alt="餐點照片 ${i+1}">`:''}<button class="quiet" data-action="remove-photo" data-index="${i}">移除照片 ${i+1}</button></div>`).join('')}</div>`:'<p>每餐最多 6 張。</p>'}<div class="photo-buttons"><label class="photo-option photo-camera"><span aria-hidden="true">◉</span><span>開啟相機</span><input id="photo-camera" type="file" accept="image/*" capture="environment"></label><label class="photo-option photo-gallery"><span aria-hidden="true">▣</span><span>從相簿選擇</span><input id="photo-gallery" type="file" multiple accept="image/*"></label></div></div></div><div class="field"><label for="form-note">補充說明</label><input id="form-note" maxlength="500" value="${escapeHtml(f.note)}" placeholder="例如：飯只吃一半、飲料有糖"></div><div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><button class="btn btn-soft" data-action="analyze" ${!f.photos.length?'disabled':''}>分析餐點</button>${f.estimated?.min_kcal!=null?`<span class="estimate-pill">推估範圍 ${whole(f.estimated.min_kcal)}–${whole(f.estimated.max_kcal)} kcal</span>`:''}</div>${f.estimated?.assumption?`<p style="font-size:12px;margin:8px 0">估算假設：${escapeHtml(f.estimated.assumption)}</p>`:''}<div class="form-grid"><div class="field"><label for="form-date">用餐日期</label><input id="form-date" type="date" value="${f.day}"></div><div class="field"><label for="form-type">餐別</label><select id="form-type">${['breakfast','lunch','dinner','snack'].map(t=>`<option value="${t}" ${t===f.meal_type?'selected':''}>${mealNames(t)}</option>`).join('')}</select></div></div><div class="form-grid"><div class="field"><label for="form-restaurant">用餐地點（選填）</label><input id="form-restaurant" maxlength="100" value="${escapeHtml(f.restaurant)}" placeholder="餐廳、家裡或地址"><button class="btn btn-outline btn-small location-button" data-action="locate">使用目前位置</button></div></div><hr class="divider"><div class="section-title" style="margin-top:0"><h3>食物與熱量明細</h3><button class="btn btn-outline btn-small" data-action="add-item">＋ 新增一項</button></div><p class="tiny" style="margin-top:-8px">每一項食物的總熱量先填在左邊，再分配各自實際吃掉的百分比。</p>${f.items.map((item,i)=>formItem(i,item)).join('')||'<p>請新增至少一項食物。</p>'}<div class="split-preview">${sums.map(({member,total})=>`<span>${escapeHtml(member.display_name)}：${whole(total.kcal)} kcal</span>`).join('')}</div></div><div class="modal-actions">${f.id?`<button class="btn btn-danger" data-action="delete-meal">刪除紀錄</button>`:'<span></span>'}<div style="display:flex;gap:8px"><button class="btn btn-outline" data-action="close-modal">取消</button><button class="btn btn-primary" data-action="save-meal">儲存這一餐</button></div></div></div></div>`}
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
 const meal={day:f.day,meal_type:f.meal_type,note:f.note,restaurant:f.restaurant,image_path:paths[0]||null,items:f.items,estimate_meta:{...f.originalMeta,...f.estimated,extraPhotos:paths.slice(1),...(f.dailyAdvice?{dailyAdvice:f.dailyAdvice}:{})}};
 if(state.demo){if(f.id){const i=state.meals.findIndex(m=>m.id===f.id);if(i>=0)state.meals[i]={...state.meals[i],...meal}}else state.meals.unshift({...meal,id:newUUID(),created_at:new Date().toISOString(),created_by:currentUserId(),space_id:'demo'});demoWrite()}
 else{let response;if(f.id)response=await client.from('meals').update(meal).eq('id',f.id).eq('space_id',state.space.id);else response=await client.from('meals').insert({...meal,space_id:state.space.id,created_by:currentUserId()});if(response.error)throw response.error;committed=true;state.date=f.day;
 try{await loadMeals()}catch{state.modal=null;state.currentForm=null;render();return toast('已儲存到雲端，請重新整理以載入餐點')}}
 if(!state.demo){const removed=f.originalPhotos.filter(path=>!paths.includes(path));if(removed.length)await client.storage.from('meal-photos').remove(removed)}
 state.photoDrafts=(state.photoDrafts||[]).filter(draft=>draft!==f);
 state.currentForm=state.photoDrafts[0]||null;
 state.modal=state.currentForm?'meal':null;
 state.date=f.day;render();toast(state.currentForm?'這餐已儲存，請確認下一餐':'餐點已儲存');
 }catch(e){if(uploaded.length&&!committed)await client.storage.from('meal-photos').remove(uploaded).catch(()=>{});toast(friendlyError(e))}finally{setBusy(false)}}
async function deleteMeal(){const f=state.currentForm;if(!f?.id||!confirm('確定要刪除這筆餐點紀錄嗎？'))return;setBusy(true);try{if(state.demo){state.meals=state.meals.filter(m=>m.id!==f.id);demoWrite()}else{const {error}=await client.from('meals').delete().eq('id',f.id).eq('space_id',state.space.id);if(error)throw error;await loadMeals();if(f.originalPhotos.length)await client.storage.from('meal-photos').remove(f.originalPhotos)}state.modal=null;state.currentForm=null;render();toast('已刪除餐點')}catch(e){toast(friendlyError(e))}finally{setBusy(false)}}
async function authSubmit(form){const fd=new FormData(form),email=String(fd.get('email')).trim(),password=String(fd.get('password'));setBusy(true);try{if(state.authMode==='login'){const {data,error}=await client.auth.signInWithPassword({email,password});if(error)throw error;state.session=data.session;await loadWorkspace();state.notice='';render()}else{const {data,error}=await client.auth.signUp({email,password});if(error)throw error;if(data.session){state.session=data.session;await loadWorkspace();render()}else toast('註冊完成，請到信箱點擊驗證連結，之後再登入')}}catch(e){toast(friendlyError(e))}finally{setBusy(false)}}
async function spaceSubmit(form,isCreate){const fd=new FormData(form);const nickname=String(fd.get('nickname')||'').trim();setBusy(true);try{let response;if(isCreate)response=await client.rpc('create_shared_space',{p_space_name:String(fd.get('spaceName')||'我們的餐桌'),p_display_name:nickname});else response=await client.rpc('join_shared_space',{p_invite_code:String(fd.get('invite')||'').trim().toUpperCase(),p_display_name:nickname});if(response.error)throw response.error;await loadWorkspace();render();toast(isCreate?'已建立雙人空間，請分享邀請碼':'已加入雙人空間')}catch(e){toast(friendlyError(e))}finally{setBusy(false)}}
function goalModal(){
  const goal=currentMember()?.daily_goal, estimate=dailyExpenditure(readProfile());
  return journalModal('每日熱量目標(kcal)',`<form id="goal-form">
    <label class="field" for="goal-value">每日熱量目標</label>
    <input id="goal-value" name="goal" type="number" min="500" max="10000" step="1" inputmode="numeric" value="${goal==null?'':n(goal)}">
    <p class="tiny">留空可取消目標。</p>
    ${estimate?`<p>估計維持熱量 <strong>${whole(estimate)} kcal／天</strong></p>
      <button type="button" class="btn btn-outline btn-small" data-action="use-estimate">填入維持熱量</button>`:''}
    <button class="btn btn-primary" type="submit">儲存目標</button></form>
    <section class="goal-section"><h3>身體資料與活動量</h3>${profileForm()}</section>
    <section class="goal-section"><p class="tiny">活動日期 ${state.date}</p>${activityForm()}</section>`);
}
async function saveGoal(form){
  const member=currentMember();
  if(!member||state.busy)return;
  const value=new FormData(form).get('goal');
  const goal=value===''?null:Number(value);
  setBusy(true);
  try{
    if(state.demo){
      const goals=Object.fromEntries(state.members.map(person=>[person.user_id,person.daily_goal]));
      localStorage.setItem('daily-plate-demo-goals',JSON.stringify({...goals,[member.user_id]:goal}));
    }else{
      const {error}=await client.from('memberships').update({daily_goal:goal}).eq('user_id',member.user_id).eq('space_id',state.space.id).select('user_id').single();
      if(error)throw error;
    }
    member.daily_goal=goal;
    state.modal=state.goalBack||null;
    render();
    toast('每日目標已更新');
  }catch(error){toast(friendlyError(error))}finally{setBusy(false)}
}
document.addEventListener('submit',async e=>{if(e.target.id==='weekly-activity-form'){e.preventDefault();await saveWeeklyActivity(e.target)}if(e.target.id==='advice-form'){e.preventDefault();await saveAdvice(e.target)}if(e.target.id==='display-name-form'){e.preventDefault();await saveDisplayName(e.target)}if(e.target.id==='goal-form'){e.preventDefault();await saveGoal(e.target)}if(e.target.id==='activity-form'){e.preventDefault();saveDayActivity(e.target)}if(e.target.id==='profile-form'){e.preventDefault();saveProfile(e.target)}if(e.target.id==='auth-form'){e.preventDefault();await authSubmit(e.target)}if(e.target.id==='create-space-form'){e.preventDefault();await spaceSubmit(e.target,true)}if(e.target.id==='join-space-form'){e.preventDefault();await spaceSubmit(e.target,false)}});
document.addEventListener('click',async e=>{const el=e.target.closest('[data-action]');if(!el)return;const action=el.dataset.action;
 if(action==='settings')state.settingsChild=false;
 if(el.hasAttribute('data-settings-link'))state.settingsChild=true;
 if(action==='toggle-auth'){state.authMode=state.authMode==='login'?'signup':'login';render()}
 else if(action==='signout'){await client.auth.signOut();state.session=null;state.space=null;state.modal=null;state.page='home';state.memberView=null;render()}
 else if(action==='prev-day'||action==='next-day'){
   const day=shiftDate(state.date,action==='prev-day'?-1:1);
   state.historyEnd=day;await changeDay(day);
 }
 else if(action==='home'){if(state.page==='records')state.memberView=null;state.page='home';render()}
 else if(action==='today'){
   const today=dateKey(new Date());
   state.historyEnd=today;
   await changeDay(today);
 }
 else if(action==='yesterday')await changeDay(shiftDate(dateKey(new Date()),-1));
 else if(action==='add-meal')openNewForm(null);
 else if(action==='records'){state.page='records';state.historyEnd=state.date;render()}
 else if(action==='member-view'){state.memberView=el.dataset.id;render()}
 else if(action==='edit-profile'){state.profileEditing=true;render()}
 else if(['profile','settings','display-name','weekly-activity'].includes(action)){state.profileEditing=false;state.modal=action;render()}
 else if(action==='edit-advice'){state.adviceEditDay=el.dataset.day||state.date;render();$('advice-text')?.focus()}
 else if(action==='cancel-advice'){state.adviceEditDay=null;render()}
 else if(action==='add-activity'){
   const list=el.closest('form').querySelector('.activity-entries');
   if(list.children.length<12){list.insertAdjacentHTML('beforeend',activityEntry());list.lastElementChild.querySelector('input').focus()}
 }
 else if(action==='remove-activity')el.closest('.activity-entry').remove()
 else if(action==='section-range'){state[el.dataset.section+'Range']=Number(el.dataset.range);render()}
 else if(action==='edit-activity'){state.activityEditDay=state.date;render()}
 else if(action==='cancel-activity'){state.activityEditDay=null;render()}
 else if(action==='calendar-day'){state.historyEnd=el.dataset.day;await changeDay(el.dataset.day)}
 else if(action==='calendar-month'){
   const [year,month]=state.date.split('-').map(Number);
   await changeDay(dateKey(new Date(year,month-1+Number(el.dataset.offset),1,12)));
 }
 else if(action==='history-style'){state.historyChartOpen=true;state.historyStyle=el.dataset.style;render()}
 else if(action==='history-grouping'){state.historyChartOpen=true;state.historyGrouping=el.dataset.grouping;render()}
 else if(action==='history-range'){state.historyRange=Number(el.dataset.range);render()}
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
 else if(action==='meal-detail'){state.detailMeal=el.dataset.id;state.modal='meal-detail';render()}
 else if(action==='edit-meal'){const meal=state.meals.find(m=>m.id===el.dataset.id);if(meal)openNewForm(meal)}
 else if(action==='back-settings'){state.modal='settings';render()}
 else if(action==='close-modal'){
   if(state.photoDrafts?.length>1&&!confirm('要關閉並放棄尚未儲存的餐點草稿嗎？'))return;
   const sheet=document.querySelector('.journal-sheet');
   if(sheet&&sheet.dataset.closing)return;
   if(sheet&&!window.matchMedia('(prefers-reduced-motion: reduce)').matches){
     sheet.dataset.closing='true';
     await new Promise(resolve=>setTimeout(resolve,170));
   }
   state.settingsChild=false;state.photoDrafts=[];state.modal=null;state.currentForm=null;render();
 }
 else if(action==='show-space'){state.modal='space';render()}
 else if(action==='copy-code'){try{await navigator.clipboard.writeText(state.space.invite_code);toast('邀請碼已複製')}catch{toast('無法自動複製，請手動選取邀請碼')}}
 else if(action==='use-estimate'){$('goal-value').value=dailyExpenditure(readProfile())}
 else if(action==='goal'){state.goalBack=state.modal;state.modal='goal';render()}
 else if(action==='photo-draft'){collectFormBasic();state.currentForm=state.photoDrafts[Number(el.dataset.index)];render()}
 else if(action==='remove-photo'){collectFormBasic();state.currentForm.photos.splice(Number(el.dataset.index),1);render()}
 else if(action==='analyze')await estimatePhoto();
 else if(action==='add-item'){collectFormBasic();state.currentForm.items.push(defaultItem());render()}
 else if(action==='remove-item'){collectFormBasic();state.currentForm.items.splice(Number(el.dataset.index),1);render()}
 else if(action==='save-meal')await saveMeal();
 else if(action==='delete-meal')await deleteMeal();
});
document.addEventListener('change',async e=>{if(e.target.id==='record-date')state.historyEnd=e.target.value;
 if(e.target.id==='date-control'||e.target.id==='record-date')await changeDay(e.target.value);
 if(e.target.id==='form-date'&&state.currentForm)state.currentForm.dateEdited=true;
 if(e.target.id==='form-type'&&state.currentForm)state.currentForm.mealTypeEdited=true;
 if(['photo-camera','photo-gallery'].includes(e.target.id)){
   const files=Array.from(e.target.files||[]);
   const form=state.currentForm;
   if(!form||!files.length)return;
   const batch=!form.id&&!form.photos.length&&files.length>1;
   const limit=batch?24:6;
   if(form.photos.length+files.length>limit){e.target.value='';return toast(`這次最多可加入 ${limit} 張照片`)}
   collectFormBasic();setBusy(true);
   try{
     const photos=[];
     for(const file of files)photos.push({image:await photoToDataUrl(file),taken:await photoDate(file,e.target.id==='photo-camera')});
     if(batch){
       const groups=groupMealPhotos(photos);
       const drafts=groups.map((group,i)=>{
         const draft=i===0?form:makeMealDraft();
         draft.photos=group.map(photo=>photo.image);
         draft.photoTimeUnknown=!group[0].taken;
         setDraftTime(draft,group[0].taken);
         return draft;
       });
       const previous=state.photoDrafts||[];
       state.photoDrafts=previous.includes(form)?previous.flatMap(draft=>draft===form?drafts:[draft]):drafts;
     }else{
       if(!form.id&&!form.photos.length)setDraftTime(form,photos[0].taken);
       form.photos.push(...photos.map(photo=>photo.image));
     }
     form.estimated=null;render();
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

function setDraftTime(draft,taken){
  if(!taken)return;
  if(!draft.dateEdited)draft.day=dateKey(taken);
  if(!draft.mealTypeEdited)draft.meal_type=mealTypeAt(taken);
}
function groupMealPhotos(photos){
  const known=photos.filter(photo=>photo.taken).sort((a,b)=>a.taken-b.taken);
  const groups=[];
  for(const photo of known){
    const group=groups.at(-1), first=group?.[0]?.taken;
    if(first&&group.length<6&&dateKey(first)===dateKey(photo.taken)&&
      mealTypeAt(first)===mealTypeAt(photo.taken)&&photo.taken-first<=90*60*1000){
      group.push(photo);
    }else groups.push([photo]);
  }
  return groups.concat(photos.filter(photo=>!photo.taken).map(photo=>[photo]));
}
function draftNavigation(form){
  const drafts=state.photoDrafts||[];
  const buttons=drafts.length>1?`<div class="journal-controls">${drafts.map((draft,i)=>
    `<button class="btn btn-small ${draft===form?'btn-primary':'btn-outline'}" data-action="photo-draft" data-index="${i}" aria-pressed="${draft===form}">${draft.photoTimeUnknown?`待確認 ${i+1}`:`${dayLabel(draft.day)} ${mealNames(draft.meal_type)} · ${i+1}`}</button>`).join('')}</div>`:'';
  return buttons+(form.photoTimeUnknown?'<p class="tiny">這張照片沒有可讀取的拍攝時間，請確認日期和餐別。</p>':'');
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
  return `<div class="modal-backdrop"><section class="modal ${title==='設定'?'journal-sheet settings-sheet':''}" role="dialog" aria-modal="true" aria-label="${title}" ${title==='顯示名稱'?'data-compact-modal':''}><div class="modal-head"><h2>${title}</h2><button class="x" data-action="close-modal" aria-label="關閉">×</button></div>${html}</section></div>`;
}
function displayNameModal(){
  return journalModal('顯示名稱',`<form id="display-name-form">
    <label class="field" for="display-name">你在日記上顯示的名字</label>
    <input id="display-name" name="displayName" maxlength="40" required value="${escapeHtml(currentMember()?.display_name||'')}">
    <p><button class="btn btn-primary" type="submit">儲存名稱</button></p></form>`);
}
async function saveDisplayName(form){
  const member=currentMember();
  if(!member||state.busy)return;
  const name=String(new FormData(form).get('displayName')||'').trim();
  if(!name||name.length>40)return toast('請輸入 1 至 40 字的顯示名稱');
  setBusy(true);
  try{
    if(state.demo)localStorage.setItem('daily-plate-demo-name',name);
    else{
      const {error}=await client.from('memberships').update({display_name:name})
        .eq('space_id',state.space.id).eq('user_id',member.user_id).select('user_id').single();
      if(error)throw error;
    }
    member.display_name=name;
    state.modal='settings';
    render();toast('顯示名稱已更新');
  }catch(error){toast(friendlyError(error))}finally{setBusy(false)}
}

function settingsModal(){
  const options=[
    ['display-name','顯示名稱',null,currentMember()?.display_name],
    ['weekly-activity','固定運動日',null,weeklyActivity(currentMember()).days.slice().sort().map(day=>'週'+'日一二三四五六'[day]).join('、') || '未設定'],
    ['profile','身高、體重與活動量',null,dailyExpenditure(readProfile())?'已設定':'未設定'],
    ['goal','每日熱量目標',currentUserId(),currentMember()?.daily_goal?whole(currentMember().daily_goal)+' kcal':'未設定'],
    state.space?['show-space',state.members.length===1?'單人使用 · 邀請夥伴':'雙人空間']:
      ['demo-mode',state.members.length===1?'切換雙人試用':'切換單人試用'],
    ['show-install','加入手機主畫面']
  ];
  if(state.session)options.push(['signout','登出']);
  return journalModal('設定',`<div class="journal-settings-list">${options.map(([action,label,user,value])=>
    `<button class="settings-row" data-settings-link data-action="${action}" ${user?`data-user="${user}"`:''}><span>${escapeHtml(label)}</span>${value?`<small>${escapeHtml(value)}</small>`:''}<span class="settings-chevron" aria-hidden="true">›</span></button>`).join('')}</div>`);
}

function profileModal(){
  const p=readProfile(), expenditure=dailyExpenditure(p);
  if(!expenditure||state.profileEditing)return journalModal('個人資料',profileForm());
  const values=[['身高',p.height+' cm'],['體重',p.weight+' kg'],['年齡',p.age+' 歲'],
    ['估算公式使用的性別',p.sex==='female'?'女性':'男性'],
    ['活動量',activityOptions.find(([factor])=>factor===p.activity)?.[1]||'—'],
    ['估計每日消耗',whole(expenditure)+' kcal']];
  return journalModal('個人資料',`<dl class="settings-summary">${values.map(([label,value])=>
    `<div><dt>${label}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl>
    <button class="btn btn-outline" data-action="edit-profile">修改個人資料</button>`);
}
function profileForm(){
  const p=readProfile(), fields=[['height','身高（cm）',80,250,0.1],['weight','體重（kg）',20,400,0.1],['age','年齡',19,120,1]];
  return `<form id="profile-form"><div class="form-grid">
    ${fields.map(([name,label,min,max,step])=>`<label class="field">${label}<input type="number" name="${name}" min="${min}" max="${max}" step="${step}" value="${n(p[name])||''}" required></label>`).join('')}
    <label class="field">估算公式使用的性別<select name="sex" required><option value="">請選擇</option><option value="female" ${p.sex==='female'?'selected':''}>女性</option><option value="male" ${p.sex==='male'?'selected':''}>男性</option></select></label>
    <label class="field">活動量<select name="activity">${activityOptions.map(([factor,label])=>`<option value="${factor}" ${p.activity===factor?'selected':''}>${label}</option>`).join('')}</select></label></div>
    <p>估計每日消耗 ${dailyExpenditure(p)?whole(dailyExpenditure(p))+' kcal':'—'}</p>
    <p class="tiny">個人資料儲存在目前瀏覽器。</p><button class="btn btn-primary">儲存個人資料</button></form>`;
}
async function saveProfile(form){
  const data=new FormData(form);
  const p=Object.fromEntries(['height','weight','age','activity'].map(key=>[key,Number(data.get(key))]));
  p.sex=data.get('sex');
  if(dailyExpenditure(p)<=0)return toast('請確認身高、體重和年齡');
  try{
    localStorage.setItem(profileKey(),JSON.stringify(p));
    state.profileEditing=false;
    if(!state.demo){
      const member=currentMember(), baseline=dailyExpenditure(p);
      const {error}=await client.from('memberships').update({baseline_kcal:baseline})
        .eq('space_id',state.space.id).eq('user_id',member.user_id).select('user_id').single();
      if(error){render();return toast('個人資料已儲存在此瀏覽器，共用消耗尚未同步')}
      member.baseline_kcal=baseline;
    }
    render();toast('個人資料已儲存');
  }catch{toast('瀏覽器無法儲存個人資料')}
}
function historySeries(people,end,length){
  const days=Array.from({length},(_,index)=>shiftDate(end,index-length+1));
  const size=length===7||(length>7&&state.historyGrouping!=='week')?1:7;
  const buckets=[];
  for(let to=days.length;to>0;to-=size)buckets.unshift(days.slice(Math.max(0,to-size),to));
  return buckets.map(days=>({
    start:days[0],end:days.at(-1),
    values:people.map(member=>{
      const totals=days.flatMap(day=>{
        const own=state.meals.filter(meal=>meal.day===day&&meal.items?.some(item=>getShare(item,member.user_id)>0));
        return own.length?[personTotals(own,member.user_id).kcal]:[];
      });
      return totals.length?Math.round(totals.reduce((sum,value)=>sum+value,0)/totals.length):null;
    })
  }));
}
function historyValueLabel(value,member,day,length){
  const base=n(member.daily_goal);
  const goal=base+(dayActivity(member,day).extraKcal);
  return `${whole(value)} kcal${length===7&&base&&value>goal?` · 超標 ${whole(value-goal)} kcal`:''}`;
}
function historyBalance(member,start,end,baseline){
  const own=member.user_id===currentUserId();
  const expenditure=own?(baseline||n(member.baseline_kcal)):n(member.baseline_kcal);
  if(!expenditure)return null;
  const values=[];
  for(let day=start;day<=end;day=shiftDate(day,1)){
    const meals=state.meals.filter(meal=>meal.day===day&&meal.items?.some(item=>getShare(item,member.user_id)>0));
    if(meals.length)values.push(expenditure+(dayActivity(member,day).extraKcal)-personTotals(meals,member.user_id).kcal);
  }
  return values.length?Math.round(values.reduce((sum,value)=>sum+value,0)/values.length):null;
}
function balanceLabel(value){
  return value===0?'收支相抵':`${value>0?'赤字':'盈餘'} ${whole(Math.abs(value))} kcal`;
}
function dailyHistory(){
  const length=state.historyRange||7, people=viewedMembers(), end=state.date;
  const series=historySeries(people,end,length);
  const baseline=dailyExpenditure(readProfile());
  const balances=series.map(row=>people.map(member=>historyBalance(member,row.start,row.end,baseline)));
  const balanceMax=Math.max(1,...balances.flat().map(value=>Math.abs(value??0)));
  const max=Math.ceil(Math.max(500,...series.flatMap(row=>row.values))/500)*500;
  const x=i=>54+i*278/Math.max(1,series.length-1);
  const y=value=>138-value/max*118;
  const colors=['#28765c','#a35734'];
  const palette=people.map(member=>colors[orderedMembers().findIndex(person=>person.user_id===member.user_id)]||colors[0]);
  const labels=length===7?series.map((_,i)=>i):[0,Math.floor((series.length-1)/2),series.length-1];
  const barWidth=Math.min(14,220/series.length);
  const dateLabel=day=>day.slice(5).replace('-','/');
  const horizontal=state.historyStyle==='bars';
  const styles=`<div class="journal-controls" role="group" aria-label="圖表樣式"><button class="btn btn-small ${horizontal?'btn-outline':'btn-primary'}" data-action="history-style" data-style="line" aria-pressed="${!horizontal}">折線圖</button><button class="btn btn-small ${horizontal?'btn-primary':'btn-outline'}" data-action="history-style" data-style="bars" aria-pressed="${horizontal}">橫條圖</button></div>`;
  const summary=people.map(member=>{
    const value=historySeries([member],state.date,7).at(-1).values[0];
    const balance=historyBalance(member,state.date,state.date,baseline);
    const expenditure=value!==null&&balance!==null?value+balance:null;
    return `<div class="trend-kpi"><strong>${escapeHtml(member.display_name)}</strong>
      <span>攝取 <b>${value===null?'未記錄':whole(value)+' kcal'}</b></span>
      <span>估計消耗 <b>${expenditure===null?'—':whole(expenditure)+' kcal'}</b></span>
      <span class="${balance<0?'trend-surplus':''}">${balance===null?'收支待估':balanceLabel(balance)}</span></div>`;
  }).join('');
  const periodCard=`<section class="period-balance"><h3>${length} 天累積收支</h3><details class="inline-info"><summary aria-label="累積收支說明">ⓘ</summary><p>只加總有攝取及消耗估算的日期。</p></details>
    <div>${people.map((member,j)=>`<p><span>${escapeHtml(member.display_name)}</span><strong class="${periodNetBalance(member,end,length,baseline)<0?'trend-surplus':periodNetBalance(member,end,length,baseline)>0?'trend-deficit':''}">${balances.some(row=>row[j]!==null)?balanceLabel(periodNetBalance(member,end,length,baseline)):'—'}</strong></p>`).join('')}</div>
    </section>`;
  const dailyRows=series.map((row,i)=>({...row,balances:balances[i]})).filter(row=>row.values.some(value=>value!==null)).reverse();
  const dates=Array.from({length},(_,i)=>shiftDate(state.date,-i));
  const ledger=`<section class="trend-card activity-history"><h3>近 ${length} 天熱量</h3>
    ${dates.map(day=>`<section><h4>${dayLabel(day)}</h4>${people.map(member=>{
      const intake=historySeries([member],day,7).at(-1).values[0];
      const balance=historyBalance(member,day,day,baseline);
      const own=member.user_id===currentUserId();
      const base=(own?baseline:0)||n(member.baseline_kcal);
      const extra=dayActivity(member,day).extraKcal;
      return `<div class="activity-history-member"><strong>${escapeHtml(member.display_name)}</strong>
        <div class="balance-values expenditure-values">
          <span>攝取<strong>${intake===null?'未記錄':whole(intake)+' kcal'}</strong></span>
          <span>估計消耗<strong>${base?whole(base+extra)+' kcal':'—'}</strong></span>
          <span>估計收支<strong class="${balance<0?'trend-surplus':'trend-deficit'}">${balance===null?'—':balanceLabel(balance)}</strong></span>
        </div></div>`;
    }).join('')}</section>`).join('')}</section>`;
  return `<section class="trend-card calorie-trend"><h3>當日熱量</h3>
    <div class="trend-kpis" aria-label="${dateLabel(state.date)} 攝取與收支">${summary}</div></section>
    <div class="trend-ranges" role="group" aria-label="趨勢區間">
    ${[7,30,90].map(days=>`<button type="button" aria-pressed="${length===days}" data-action="history-range" data-range="${days}">${days} 天</button>`).join('')}</div>
    ${periodCard}<details class="trend-card"><summary>查看逐日熱量明細</summary>${ledger}</details>
    <details class="trend-card calorie-trend" open><summary>熱量趨勢圖</summary>
    ${styles}${length>7?`<div class="trend-ranges">${[['day','每日'],['week','每週平均']].map(([key,label])=>`<button data-action="history-grouping" data-grouping="${key}" aria-pressed="${(state.historyGrouping||'day')===key}">${label}</button>`).join('')}</div>`:''}<p class="tiny">${series.length===length?'每日攝取（kcal）':'每週有紀錄日的平均攝取（kcal）'}</p>
    ${horizontal?`<div class="trend-table"><div class="trend-table-head"><span>日期／成員</span><span>攝取</span><span>估計收支</span></div>
    ${dailyRows.map(row=>row.values.map((value,j)=>value===null?'':`<div class="trend-table-row">
      <span>${dateLabel(row.start)}${row.start!==row.end?'–'+dateLabel(row.end):''}<small>${escapeHtml(people[j].display_name)}</small></span>
      <span><b>${whole(value)}</b><span class="daily-chart-track"><span style="width:${value/max*100}%;background:${palette[j]}"></span></span></span>
      <span class="${row.balances[j]<0?'trend-surplus':''}">${row.balances[j]===null?'—':balanceLabel(row.balances[j])}</span>
    </div>`).join('')).join('')||'<p>這段期間還沒有紀錄。</p>'}</div>`:`<div class="trend-panels">${people.map((member,j)=>{
      const totals=series.map(row=>row.values[j]).filter(value=>value!==null);
      const average=totals.length?whole(totals.reduce((sum,value)=>sum+value,0)/totals.length)+' kcal':'未記錄';
      const hasBalance=balances.some(row=>row[j]!==null);
      return `<div class="trend-person">
      <div class="trend-person-head"><strong>${escapeHtml(member.display_name)}</strong><span>${length===7&&totals.length?'日均 ':''}${length===7||!totals.length?average:''}</span></div>
      <svg class="trend-plot" viewBox="0 0 350 ${hasBalance?255:166}" role="img" aria-label="${escapeHtml(member.display_name)} 的攝取折線${hasBalance?'與熱量赤字長條圖':'圖'}">
      ${[0,.5,1].map(f=>`<line x1="52" y1="${y(max*f)}" x2="338" y2="${y(max*f)}" stroke="#dce8df"/><text x="46" y="${y(max*f)+4}" text-anchor="end">${whole(max*f)}</text>`).join('')}
      ${labels.map(i=>`<text x="${x(i)}" y="${hasBalance?247:158}" text-anchor="middle">${dateLabel(series[i].end)}</text>`).join('')}
      ${series.map(({values},i)=>{
        const value=values[j], previous=series[i-1]?.values[j];
        if(value===null)return '';
        return `${previous!=null?`<line x1="${x(i-1)}" y1="${y(previous)}" x2="${x(i)}" y2="${y(value)}" stroke="${palette[j]}" stroke-width="2.5"/>`:''}
          <circle cx="${x(i)}" cy="${y(value)}" r="3.5" fill="${palette[j]}"><title>${dateLabel(series[i].end)} · ${whole(value)} kcal</title></circle>
          ${length===7&&series[i].end===state.date?`<text x="${x(i)}" y="${y(value)-8}" text-anchor="middle">${whole(value)}</text>`:''}`;
      }).join('')}
      ${hasBalance?`<text x="52" y="158">${series.length===length?'每日收支':'每週平均收支'}</text>
      <line x1="52" x2="338" y1="198" y2="198" stroke="#a0b7a9"/><text x="46" y="202" text-anchor="end">0</text>
      ${balances.map((row,i)=>{
        const value=row[j];
        if(value===null)return '';
        const height=Math.max(2,Math.abs(value)/balanceMax*26);
        const top=value>=0?198-height:198;
        return `<rect x="${x(i)-barWidth/2}" y="${top}" width="${barWidth}" height="${height}" rx="2" fill="${value>=0?'#28765c':'#b65337'}"><title>${balanceLabel(value)}</title></rect>
        ${length===7?`<text x="${x(i)}" y="${value>=0?top-4:top+height+11}" text-anchor="middle">${whole(Math.abs(value))}</text>`:''}`;
      }).join('')}`:''}</svg>
      <p class="tiny">${hasBalance?'綠色向上為赤字，紅色向下為盈餘。夥伴使用共用的平常消耗估算。':'有飲食紀錄與可用的消耗估算時顯示赤字。'}</p></div>`;
    }).join('')}</div>`}
</details>`;
}
function activityKey(day=state.date){
  return `daily-plate-activity-${currentUserId()}-${day}`;
}
function dayActivity(member,day=state.date){
  const own=member?.user_id===currentUserId();
  let saved={};
  if(own){
    try{saved=JSON.parse(localStorage.getItem(activityKey(day)))||{}}catch{}
  }
  const entries=[...(saved.entries??(saved.extraKcal?[{name:'額外運動',kcal:saved.extraKcal}]:[]))];
  const name=member?scheduledActivity(member,day):'';
  if(name&&!saved.scheduleReviewed&&!entries.some(entry=>entry.name===name)){
    entries.push({name,minutes:60,kcal:name.includes('網球')?400:0,scheduled:true});
  }
  return {...saved,entries,extraKcal:entries.reduce((sum,entry)=>sum+n(entry.kcal),0)};
}
function readDayActivity(day){return dayActivity(currentMember(),day)}
function saveDayActivity(form){
  const fields=new FormData(form);
  const names=fields.getAll('activityName'), minutes=fields.getAll('activityMinutes'), calories=fields.getAll('activityKcal');
  const entries=names.map((name,i)=>({name:String(name).trim(),minutes:n(minutes[i]),kcal:n(calories[i])}))
    .filter(entry=>entry.name||entry.minutes||entry.kcal);
  if(entries.some(entry=>!entry.name))return toast('請填寫運動名稱');
  const activity={scheduleReviewed:true,steps:n(fields.get('steps')),entries,extraKcal:entries.reduce((sum,entry)=>sum+entry.kcal,0)};
  try{localStorage.setItem(activityKey(),JSON.stringify(activity));state.activityEditDay=null;render();toast('活動紀錄已儲存')}
  catch{toast('瀏覽器無法儲存活動紀錄')}
}
function activityEntry(entry={}){
  return `<div class="activity-entry">
    <label>運動名稱<input name="activityName" maxlength="40" value="${escapeHtml(entry.name||'')}" placeholder="例如：網球"></label>
    <label>分鐘<input name="activityMinutes" type="number" min="0" max="1440" step="1" value="${entry.minutes||''}"></label>
    <label>額外 kcal<input name="activityKcal" type="number" min="0" step="1" value="${entry.kcal||''}"></label>
    <button type="button" class="quiet" data-action="remove-activity" aria-label="移除此運動">移除</button></div>`;
}
function activityForm(){
  const {steps,entries:activities}=readDayActivity();
  return `<form id="activity-form" class="summary-card activity-card">
    <h3>當日活動</h3>
    <label class="field">步數<input name="steps" type="number" min="0" step="1" value="${steps??''}" inputmode="numeric"></label>
    <div class="activity-entries">${activities.map(activityEntry).join('')}</div>
    <button type="button" class="btn btn-outline btn-small" data-action="add-activity">＋ 新增運動</button>
    <p class="tiny">分鐘與額外熱量可留空。只把平常活動量以外的消耗加到當日目標。資料存於此瀏覽器。</p>
    <button class="btn btn-primary btn-small">儲存活動</button> <button type="button" class="btn btn-outline btn-small" data-action="cancel-activity">取消</button></form>`;
}

function adviceMeal(day=state.date){
  const meals=state.meals.filter(meal=>meal.day===day);
  return meals.find(meal=>(meal.estimate_meta?.dailyAdvice||meal.estimate_meta?.mealPlans))||meals.at(-1);
}
function advicePanel(day=state.date){
  const meal=adviceMeal(day);
  if(!meal)return '<p class="compact-empty">這天有餐點紀錄後，就可以留下建議。</p>';
  const advice=meal.estimate_meta?.dailyAdvice||'';
  const plans=meal.estimate_meta?.mealPlans||{};
  const fields=[['review','今天的餐點回顧'],['breakfast','早餐'],['lunch','午餐'],['dinner','晚餐']];
  const planCards=(state.adviceEditDay===day?orderedMembers():viewedMembers()).map(person=>`<section class="advice-plan"><h4>${escapeHtml(person.display_name)}</h4>${fields.map(([key,label])=>{
    const value=plans[person.user_id]?.[key]||'';
    const heading=key==='breakfast'?'<h5>明天的三餐提案</h5>':'';
    return heading+(state.adviceEditDay===day?`<label>${label}<input name="plan:${person.user_id}:${key}" maxlength="240" value="${escapeHtml(value)}"></label>`:`<p class="advice-line"><strong>${label}</strong><span>${escapeHtml(value||'待補上')}</span></p>`);
  }).join('')}</section>`).join('');
  return `<section class="summary-card advice-card"><h3>${dayLabel(day)}的飲食建議</h3>
    
    ${state.adviceEditDay===day?`<form id="advice-form">
      <label class="field" for="advice-text">${advice?'修改建議':'新增建議'}</label>
      <textarea id="advice-text" name="advice" rows="3" maxlength="1800">${escapeHtml(advice)}</textarea>
      ${planCards}<button class="btn btn-primary btn-small" type="submit">儲存建議</button><button type="button" class="btn btn-outline btn-small" data-action="cancel-advice">取消</button></form>`:
    `${planCards}<button class="btn btn-outline btn-small" data-action="edit-advice" data-day="${day}">${advice?'修改建議':'新增建議'}</button>`}</section>`;
}
async function saveAdvice(form){
  const meal=adviceMeal(state.adviceEditDay||state.date), data=new FormData(form), advice=String(data.get('advice')||'').trim();
  const previousPlans=meal?.estimate_meta?.mealPlans||{};
  const mealPlans=Object.fromEntries(orderedMembers().map(person=>[person.user_id,{...previousPlans[person.user_id],...Object.fromEntries(['review','breakfast','lunch','dinner'].map(key=>[key,String(data.get(`plan:${person.user_id}:${key}`)||'').trim()]))}]));
  if(!meal||advice.length>1800||state.busy)return;
  setBusy(true);
  try{
    const meta={...meal.estimate_meta,dailyAdvice:advice,mealPlans};
    if(!state.demo){
      const {data,error}=await client.from('meals').select('estimate_meta').eq('id',meal.id).eq('space_id',state.space.id).single();
      if(error)throw error;
      Object.assign(meta,data.estimate_meta,{dailyAdvice:advice,mealPlans});
      const update=await client.from('meals').update({estimate_meta:meta}).eq('id',meal.id).eq('space_id',state.space.id).select('id').single();
      if(update.error)throw update.error;
    }
    meal.estimate_meta=meta;
    if(state.demo)demoWrite();
    state.adviceEditDay=null;render();toast('建議已儲存');
  }catch(error){toast(friendlyError(error))}finally{setBusy(false)}
}

function weeklyActivity(member){
  if(state.demo){
    try{const saved=JSON.parse(localStorage.getItem('daily-plate-weekly-'+member.user_id));if(saved)return saved}catch{}
  }
  return {days:member.weekly_activity_days??(member.display_name.toLowerCase()==='jay'?[0]:[]),
    name:member.weekly_activity_name||(member.display_name.toLowerCase()==='jay'?'網球':'運動')};
}
function scheduledActivity(member,day){
  const [year,month,date]=day.split('-').map(Number);
  const schedule=weeklyActivity(member);
  return day>='2026-11-08'&&schedule.days.includes(new Date(year,month-1,date,12).getDay())?schedule.name:'';
}
function weeklyActivityModal(){
  const schedule=weeklyActivity(currentMember());
  return journalModal('固定運動日',`<form id="weekly-activity-form">
    <label class="field">運動名稱<input name="name" maxlength="40" required value="${escapeHtml(schedule.name)}"></label>
    <fieldset class="weekly-days"><legend>每週哪幾天運動</legend>${[...'日一二三四五六'].map((label,day)=>
      `<label><input type="checkbox" name="weekday" value="${day}" ${schedule.days.includes(day)?'checked':''}>週${label}</label>`).join('')}</fieldset>
    <button class="btn btn-primary" type="submit">儲存固定運動日</button></form>`);
}
async function saveWeeklyActivity(form){
  const member=currentMember(), data=new FormData(form);
  const name=String(data.get('name')||'').trim(),days=data.getAll('weekday').map(Number);
  if(!member||state.busy||!name||name.length>40)return;
  setBusy(true);
  try{
    if(state.demo)localStorage.setItem('daily-plate-weekly-'+member.user_id,JSON.stringify({name,days}));
    else{
      const {error}=await client.from('memberships').update({weekly_activity_days:days,weekly_activity_name:name})
        .eq('space_id',state.space.id).eq('user_id',member.user_id).select('user_id').single();
      if(error)throw error;
    }
    member.weekly_activity_days=days;member.weekly_activity_name=name;
    state.modal='settings';render();toast('固定運動日已儲存');
  }catch(error){toast(friendlyError(error))}finally{setBusy(false)}
}
function expenditureCard(member){
  const own=member.user_id===currentUserId();
  const baseline=(own?dailyExpenditure(readProfile()):0)||n(member.baseline_kcal);
  const extra=dayActivity(member).extraKcal;
  return `<section class="summary-card day-balance"><h3>${escapeHtml(member.display_name)} <small>當日熱量消耗</small></h3>
    <div class="balance-values expenditure-values">
      <span>平常估計消耗 <strong>${baseline?whole(baseline)+' kcal':'—'}</strong></span>
      <span>額外活動消耗 <strong>${whole(extra)+' kcal'}</strong></span>
      <span>估計總消耗 <strong>${baseline?whole(baseline+extra)+' kcal':'—'}</strong></span>
    </div>
    ${own?'':'<p class="tiny">夥伴的總消耗包含固定運動估算，手動調整保存在對方的瀏覽器。</p>'}
    ${baseline||!own?'':'<button class="btn btn-outline btn-small" data-action="profile">設定個人資料</button>'}
  </section>`;
}
function periodNetBalance(member,end,length,baseline){
  return Array.from({length},(_,i)=>shiftDate(end,-i)).reduce((total,day)=>total+(historyBalance(member,day,day,baseline)??0),0);
}
function sectionRange(section){
  return `<div class="trend-ranges" role="group" aria-label="查看區間">${[7,30,90].map(days=>
    `<button type="button" data-action="section-range" data-section="${section}" data-range="${days}" aria-pressed="${(state[section+'Range']||7)===days}">${days} 天</button>`).join('')}</div>`;
}
function monthCalendar(){
  const [year,month]=state.date.split('-').map(Number);
  const first=new Date(year,month-1,1,12), today=dateKey(new Date()), people=viewedMembers();
  const baseline=dailyExpenditure(readProfile());
  const count=new Date(year,month,0,12).getDate();
  return `<section class="trend-card journal-calendar"><div class="trend-head">
    <button class="btn btn-outline btn-small" data-action="calendar-month" data-offset="-1" aria-label="上個月">‹</button>
    <h3>${year} 年 ${month} 月</h3>
    <button class="btn btn-outline btn-small" data-action="calendar-month" data-offset="1" aria-label="下個月">›</button></div>
    <div class="calendar-toolbar"><button class="btn btn-outline btn-small" data-action="today">今天</button></div><div class="calendar-grid">${[...'日一二三四五六'].map(day=>`<span>${day}</span>`).join('')}
    ${'<span></span>'.repeat(first.getDay())}
    ${Array.from({length:count},(_,i)=>{
      const date=new Date(year,month-1,i+1,12), day=dateKey(date);
      const scheduled=people.map(person=>{
        const name=scheduledActivity(person,day);
        const activity=person.user_id===currentUserId()?readDayActivity(day):null;
        return name&&(!activity?.scheduleReviewed||activity.entries?.some(entry=>entry.name===name))?person.display_name+' '+name+'日':'';
      }).filter(Boolean);
      const values=day<=today?people.map(person=>historyBalance(person,day,day,baseline)):[];
      const ringColor=value=>value==null?'transparent':value<0?'#f4c9bd':value===0?'#e0e6e2':'#b9deca';
      const left=ringColor(values[0]), right=values.length>1?ringColor(values[1]):left;
      return `<button data-action="calendar-day" data-day="${day}" aria-pressed="${day===state.date}" aria-label="${day}${scheduled.length?' '+escapeHtml(scheduled.join('、')):''}${values.map((v,j)=>v===null?'':` ${escapeHtml(people[j].display_name)} ${balanceLabel(v)}`).join('')}">
        <span class="calendar-day-ring ${scheduled.length?'calendar-tennis':''}" style="--left:${left};--right:${right}">${i+1}</span></button>`;

    }).join('')}</div></section>`;
}
function activityRecords(){
  const people=viewedMembers(), end=state.date, count=state.activityRange||7, own=currentUserId();
  const activity=readDayActivity();
  const activityList=entries=>entries.map(entry=>`<li>${escapeHtml(entry.name)}${entry.minutes?` · ${whole(entry.minutes)} 分鐘`:''}${entry.kcal?` · ${whole(entry.kcal)} kcal`:''}${entry.scheduled?'（預估）':''}</li>`).join('');
  const summary=activityList(activity.entries);
  const ownActivity=state.activityEditDay===end?activityForm():`<section class="summary-card day-balance"><h3>當日活動</h3>
    ${activity.steps?`<p>${whole(activity.steps)} 步</p>`:''}${summary?`<ul>${summary}</ul>`:''}
    ${!activity.steps&&!summary?'<p class="tiny">尚無活動紀錄。</p>':''}<button class="btn btn-outline btn-small" data-action="edit-activity">${activity.steps||summary||activity.extraKcal?'修改活動':'新增活動'}</button></section>`;
  const days=Array.from({length:count},(_,i)=>shiftDate(end,-i));
  const profileEstimate=dailyExpenditure(readProfile());
  const history=`<div class="trend-card activity-history"><h3>近 ${count} 天消耗</h3>
    <p class="tiny">夥伴的總消耗包含固定運動估算。</p>
    ${days.map(day=>`<section><h4>${dayLabel(day)}</h4>${people.map(member=>{
      const self=member.user_id===own;
      const baseline=(self?profileEstimate:0)||n(member.baseline_kcal);
      const extra=dayActivity(member,day).extraKcal;
      return `<div class="activity-history-member"><strong>${escapeHtml(member.display_name)}</strong>
      <div class="balance-values expenditure-values">
        <span>平常估計<strong>${baseline?whole(baseline)+' kcal':'—'}</strong></span>
        <span>額外活動<strong>${whole(extra)+' kcal'}</strong></span>
        <span>總消耗<strong>${baseline?whole(baseline+extra)+' kcal':'—'}</strong></span>
      </div></div>`;
    }).join('')}</section>`).join('')}</div>`;
  return people.map(expenditureCard).join('')+
    people.map(person=>{
      if(person.user_id===own)return ownActivity;
      const summary=activityList(dayActivity(person,end).entries);
      return summary?`<section class="summary-card day-balance"><h3>${escapeHtml(person.display_name)} <small>當日活動</small></h3><ul>${summary}</ul></section>`:'';
    }).join('')+sectionRange('activity')+history;
}
function adviceRecords(){
  const count=state.adviceRange||7,start=shiftDate(state.date,1-count);
  const people=viewedMembers();
  const days=[...new Set(state.meals.filter(meal=>meal.day>=start&&meal.day<=state.date&&
    people.some(person=>['review','breakfast','lunch','dinner'].some(key=>meal.estimate_meta?.mealPlans?.[person.user_id]?.[key]))).map(meal=>meal.day))].sort().reverse();
  if(!days.includes(state.date)&&adviceMeal())days.unshift(state.date);
  return sectionRange('advice')+(days.length?days.map(advicePanel).join(''):advicePanel());
}
function recordsPage(){
  const tabs=[['meals','餐點紀錄'],['deficit','活動紀錄'],['calories','熱量紀錄'],['advice','建議']];
  const active=state.recordTab||'meals', meals=viewedMeals();
  const contents={
    meals:()=>meals.length?meals.map(mealCard).join(''):'<p>這天還沒有餐點紀錄。</p>',
    calories:dailyHistory,
    advice:adviceRecords,
    deficit:activityRecords
  };
  return `<main class="layout compact-dashboard">${datedHeader('記錄','record-date')}${memberPicker()}<div class="journal-controls">${tabs.map(([id,label])=>`<button class="btn ${id===active?'btn-primary':'btn-outline'} btn-small" aria-pressed="${id===active}" data-action="record-tab" data-tab="${id}">${label}</button>`).join('')}</div>
  <div class="meal-list">${contents[active]()}</div></main>`;
}

document.addEventListener('visibilitychange',async ()=>{
  if(document.hidden||!client||!state.session||!state.space||state.modal)return;
  const spaceId=state.space.id;
  const {data,error}=await client.from('memberships').select('*').eq('space_id',spaceId);
  if(!error&&data?.length&&state.space?.id===spaceId&&!state.modal){
    state.members=data;
    render();
  }
});

boot();
