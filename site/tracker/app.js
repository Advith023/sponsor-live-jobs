const $ = id => document.getElementById(id);
const stages = ['Researching','Ready for approval','Submitted','Receipt verified','Rejected','Withdrawn','Skipped'];
const sponsors = ['Unknown','Tentative','Confirmed for this role','Unavailable'];
const blockers = ['None recorded','CAPTCHA','Failed upload','Portal error','Other'];
const groups = {
 'Vacancy': [
 ['employer','Employer'],['title','Role title'],['location','Location'],['market','Market',['Unknown','UK','Overseas']],['family','Discipline',['Unclassified','Data analytics','Data science','Data engineering','Software engineering','Product','Design','Finance','Risk & compliance','Sales','Marketing','Operations','People & HR','Customer','Healthcare','Forecasting','Demand planning','Capacity planning','S&OP / SIOP','Operational analytics','Applied data science','KTP','Other']],['salary','Salary and currency'],['ref','Vacancy reference'],['url','Vacancy URL','url'],['deadline','Deadline','date'],['flag','Vacancy flag',['None recorded','Possible duplicate','Stale or closed']]],
 'Sponsorship and fit': [
 ['sponsor','Sponsorship confidence',sponsors],['source','Sponsorship evidence · source, date and wording','textarea'],['rtw','Right-to-work requirements','textarea'],['fit','Fit score out of 100','number'],['requirements','Key requirements','textarea']],
 'Application and next action': [
 ['stage','Application stage',stages],['approval','Approval state',['Pending','Approved','Declined']],['cv','Tailored CV version'],['letter','Cover-letter version'],['blocker','Blocker',blockers],['blockerNote','Blocker details','textarea'],['follow','Follow-up date','date'],['next','Next action','textarea']],
 'Recruiter correspondence and proof': [
 ['contact','Recruiter or hiring contact'],['email','Email thread URL','url'],['mailDate','Correspondence date','date'],['mailNote','Email subject and relevant excerpt','textarea'],['confirmation','Explicit submission confirmation · portal, email or reference','textarea'],['receipt','Verified receipt · source and reference','textarea']]
};
const checkpoints = [
 'Employer and business priorities',
 'Vacancy scope, team and expected outcomes',
 'Hiring process and assessment criteria',
 'Leadership principles and behaviours',
 'Mandatory and desirable requirements',
 'CV evidence and fit score rationale',
 'Evidence gaps and questions to resolve',
 'Sponsor register check and legal entity',
 'Role-specific sponsorship likelihood and eligibility factors',
 'Location, relocation, deadline and application materials'
];
groups['Pre-tailoring research · record findings and sources'] = [
 ...checkpoints.map((label, index) => ['check'+index, (index+1)+'. '+label, 'textarea']),
 ['research','Research review',['Pending','Reviewed']],
 ['likelihood','Role sponsorship likelihood',['Unknown','Low','Possible','Likely','Confirmed','Unavailable']],
 ['questions','Tailoring questions and answers','textarea'],
 ['clarification','Clarification state',['Not reviewed','Awaiting my answer','Resolved or none needed']],
 ['relocation','Relocation wording',['Not reviewed','Open to relocation · add to CV','Open to relocation · added','Not applicable']],
 ['coverReview','Cover letter',['Pending','Drafted','Reviewed','Not proceeding']]
];
const schema = Object.values(groups).flat();
const defaults = Object.fromEntries(schema.map(([key,,type]) => [key, Array.isArray(type) ? type[0] : '']));
const key = 'career-pipeline-v1';
const migrate = row => (row && row.clarification === 'Awaiting Advith' ? {...row, clarification: 'Awaiting my answer'} : row);
let rows = JSON.parse(localStorage.getItem(key) || '[]').map(migrate).map(row => ({...defaults, ...row}));
let editing;
const selected = new Set();
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const options = values => values.map(v => '<option>'+esc(v)+'</option>').join('');
const norm = value => (value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const today = () => new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const date = value => value ? new Intl.DateTimeFormat('en-GB',{dateStyle:'medium',timeZone:'UTC'}).format(new Date(value+'T00:00:00Z')) : 'Unknown';
const closed = row => row.flag === 'Stale or closed' || (row.deadline && row.deadline < today());
const eligible = row => row.sponsor === sponsors[2] && Boolean(row.source.trim());
function duplicates(row, pool=rows){
 return pool.filter(other => other.id !== row.id && (
  (row.url && other.url && row.url.replace(/[?#].*$/,'').replace(/\/$/,'') === other.url.replace(/[?#].*$/,'').replace(/\/$/,'')) ||
  (norm(row.employer) === norm(other.employer) && ((row.ref && norm(row.ref) === norm(other.ref)) ||
  (norm(row.title) === norm(other.title) && !(row.ref && other.ref) && (!row.location || !other.location || norm(row.location) === norm(other.location)))))
 ));
}
function issue(row,pool){
 if (!row.employer.trim() || !row.title.trim()) return 'Enter the employer and role title.';
 if ([sponsors[2],sponsors[3]].includes(row.sponsor) && !row.source.trim()) return 'Add role-specific evidence for this sponsorship decision.';
 if ((['Submitted','Receipt verified','Withdrawn'].includes(row.stage) || row.receipt) && !row.confirmation.trim()) return 'Record explicit confirmation of submission from you, the employer or the portal first.';
 if (row.stage === 'Receipt verified' && !row.receipt.trim()) return 'Record the verified receipt and its source first.';
 if (row.stage === 'Ready for approval' && (!eligible(row) || closed(row) || row.flag !== 'None recorded' || row.blocker !== blockers[0] || duplicates(row,pool).length)) return 'Resolve sponsorship, vacancy flags and blockers before marking this role ready for approval.';
 return '';
}
function persist(next){
 localStorage.setItem(key,JSON.stringify(next));
 rows=next;
 render();
}
const filterSpec=[['search','Search'],['sponsor','Sponsorship',sponsors],['stage','Stage',stages],['deadline','Deadline',['Next 7 days','Overdue','Unknown']],['fit','Fit',['80 to 100','60 to 79','0 to 59','Unscored']],['blocker','Blocker',blockers],['market','Market',['UK','Overseas','Unknown']]];
$('filters').innerHTML=filterSpec.map(([id,label,values])=>'<label>'+label+(values?'<select id="f-'+id+'"><option value="">All</option>'+options(values)+'</select>':'<input id="f-search" type="search" placeholder="Employer, role or contact">')+'</label>').join('');
$('filters').addEventListener('input',render);
function visible(row){
 const f=id=>$('f-'+id).value;
 const fit=row.fit===''?'Unscored':+row.fit>=80?'80 to 100':+row.fit>=60?'60 to 79':'0 to 59';
 const end = new Date(Date.now()+7*86400000).toISOString().slice(0,10);
 const deadline=!row.deadline?'Unknown':row.deadline<today()?'Overdue':row.deadline<=end?'Next 7 days':'Later';
 return [row.employer,row.title,row.contact,row.ref,row.location].join(' ').toLowerCase().includes(f('search').toLowerCase()) &&
 ['sponsor','stage','blocker','market'].every(id=>!f(id)||f(id)===row[id]) &&
 (!f('fit')||f('fit')===fit) && (!f('deadline')||f('deadline')===deadline);
}
function render(){
 const shown=rows.filter(visible).sort((a,b)=>(a.deadline||'9999').localeCompare(b.deadline||'9999'));
 const stats=[['Tracked roles',rows.length],['Sponsorship confirmed',rows.filter(eligible).length],['Ready for approval',rows.filter(r=>r.stage===stages[1]&&!issue(r)).length],['Receipts verified',rows.filter(r=>r.stage===stages[3]).length]];
 $('stats').innerHTML=stats.map(([label,n])=>'<div class="stat"><strong>'+n+'</strong><span>'+label+'</span></div>').join('');
 $('count').textContent=shown.length+' of '+rows.length+' roles';
 $('compare').textContent='Compare selected ('+selected.size+')';
 $('compare').disabled=selected.size<2;
 if (!shown.length){
  $('results').innerHTML='<div class="empty"><h2>'+(rows.length?'No matching roles':'Your pipeline is empty')+'</h2><p>'+(rows.length?'Clear the filters to see more opportunities.':'Add an opportunity to start checking sponsorship and tracking next steps.')+'</p><button id="empty-action">'+(rows.length?'Clear filters':'Add your first role')+'</button></div>';
  $('empty-action').onclick=()=>rows.length?(filterSpec.forEach(([id])=>$('f-'+id).value=''),render()):openEditor();
  return;
 }
 $('results').innerHTML='<div class="table"><table><thead><tr>'+['Compare','Opportunity','Sponsorship','Stage','Deadline / follow-up','Fit','Next action'].map(v=>'<th scope="col">'+v+'</th>').join('')+'</tr></thead><tbody>'+shown.map(r=>{
  const flags=[closed(r)?'Stale or past deadline':'',r.flag==='Possible duplicate'||duplicates(r).length?'Possible duplicate':'',r.blocker!==blockers[0]?r.blocker:''].filter(Boolean).join(' · ');
  return '<tr><td><input type="checkbox" aria-label="Compare '+esc(r.title)+'" data-select="'+esc(r.id)+'" '+(selected.has(r.id)?'checked':'')+'></td><td><button class="role" data-edit="'+esc(r.id)+'">'+esc(r.title)+'</button><span class="muted">'+esc(r.employer)+' · '+esc(r.location||'Location unknown')+'</span><span class="muted">'+esc(r.salary||'Salary unknown')+'</span><button data-attachments="'+esc(r.id)+'">Attachments</button></td><td><span class="pill '+(eligible(r)?'yes':r.sponsor===sponsors[3]?'no':'')+'">'+esc(r.sponsor)+'</span></td><td>'+esc(r.stage)+'<span class="muted">'+esc(r.approval)+'</span></td><td>'+date(r.deadline)+'<span class="muted">Follow-up '+date(r.follow)+'</span></td><td>'+esc(r.fit===''?'Unscored':r.fit+'/100')+'</td><td>'+esc(r.next||'None')+'<span class="muted">'+esc(flags)+'</span></td></tr>';
 }).join('')+'</tbody></table></div>';
}
function openEditor(id, draft){
 editing=rows.find(r=>r.id===id);
 const row=editing||draft||defaults;
 $('heading').textContent=editing?'Edit opportunity':'Add opportunity';
 $('remove').hidden=!editing;
 $('notice').textContent='';
 $('fields').innerHTML=Object.entries(groups).map(([group,fields])=>'<fieldset><legend>'+group+'</legend>'+fields.map(([name,label,type='text'])=>'<label>'+label+(Array.isArray(type)?'<select name="'+name+'">'+options(type)+'</select>':type==='textarea'?'<textarea name="'+name+'"></textarea>':'<input name="'+name+'" type="'+type+'" '+(type==='number'?'min="0" max="100" step="1"':'')+(['employer','title'].includes(name)?' required':'')+'>')+'</label>').join('')+'</fieldset>').join('');
 for (const [name] of schema) $('form').elements[name].value=row[name];
 $('editor').showModal();
}
$('form').onsubmit=e=>{
 e.preventDefault();
 const row={...Object.fromEntries([...new FormData(e.target)].map(([name,value])=>[name,value.trim()])),id:editing?.id||crypto.randomUUID()};
 const matches=duplicates(row);
 const enteringApproval = row.stage === 'Ready for approval' && editing?.stage !== row.stage;
 const researchIncomplete = row.research !== 'Reviewed' || checkpoints.some((_, i) => !row['check'+i]) ||
  row.clarification !== 'Resolved or none needed';
 const error=issue(row) || (enteringApproval && researchIncomplete ?
  'Record findings for all ten checks and resolve any tailoring questions before requesting approval.' :
  enteringApproval && (!row.letter || !['Drafted','Reviewed'].includes(row.coverReview) ||
   !['Open to relocation · added','Not applicable'].includes(row.relocation)) ?
  'Record the cover-letter version and confirm the relocation wording before requesting approval.' : '');
 if(error){$('notice').textContent=error;return;}
 if(matches.length && row.flag!=='Possible duplicate'){
  $('form').elements.flag.value='Possible duplicate';
  $('notice').textContent='Possible match: '+matches.map(r=>r.employer+' · '+r.title).join(', ')+'. Close to review the existing record, or save again to keep this role flagged.';
  return;
 }
 try{persist([...rows.filter(r=>r.id!==row.id),row]);$('editor').close();}
 catch{$('notice').textContent='Could not save in this browser. Export a backup before making further changes.';}
};
$('remove').onclick=()=>{if(editing&&confirm('Delete this opportunity?')){selected.delete(editing.id);persist(rows.filter(r=>r.id!==editing.id));$('editor').close();}};
const recordFields = new Map(schema.flatMap(([key,label])=>[[key.toLowerCase(),key],[label.toLowerCase(),key]]));
function parseLabelledRecord(text){
 const record=Object.create(null);
 for(const line of text.split(/\r?\n/)){
  if(!line.trim())continue;
  const separator=line.indexOf(':');
  if(separator<0)throw Error('Use one field per line in the format Employer: Company name.');
  const label=line.slice(0,separator).trim();
  const key=recordFields.get(label.toLowerCase());
  if(!key)throw Error('Unrecognised field: '+label+'. Use the labels in Show blank template.');
  if(Object.hasOwn(record,key))throw Error('Field appears twice: '+label+'. Paste one role at a time.');
  record[key]=line.slice(separator+1).trim();
 }
 return record;
}
function parseRecord(input){
 const text=input.trim().replace(/^```(?:json|text|plaintext)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/i,'$1').trim();
 const record=/^[{\[]/.test(text)?JSON.parse(text):parseLabelledRecord(text);
 if(!record||typeof record!=='object'||Array.isArray(record)) throw Error('Paste one JSON object.');
 for(const key of Object.keys(record)){
  if(!Object.hasOwn(defaults,key)) throw Error('Unrecognised field: '+key);
 }
 const draft={...defaults};
 for(const [key,label,type] of schema){
  const raw=record[key];
  if(raw==null||raw==='')continue;
  if(typeof raw!=='string'&&!(type==='number'&&typeof raw==='number'))throw Error('Use a text value for '+label+'.');
  const value=String(raw).trim();
  if(!value)continue;
  if(Array.isArray(type)&&!type.includes(value))throw Error(label+' accepts: '+type.join(', ')+'.');
  if(type==='number'&&!/^(100|[1-9]?[0-9])$/.test(value))throw Error('Fit must be a whole number from 0 to 100.');
  if(type==='date'&&(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value))throw Error('Use a valid YYYY-MM-DD date for '+label+'.');
  draft[key]=value;
 }
 if(!draft.employer||!draft.title)throw Error('Include employer and title.');
 return draft;
}
$('paste-role').onclick=()=>{
 $('record-text').value='';
 $('paste-error').textContent='';
 $('paste-dialog').showModal();
};
$('record-template').onclick=()=>{
 if(!$('record-text').value.trim()) $('record-text').value=schema.map(([key,label])=>label+': '+defaults[key]).join('\n');
 else $('paste-error').textContent='Clear the current text first to show the blank template.';
};
$('paste-form').onsubmit=e=>{
 e.preventDefault();
 let draft;
 try{draft=parseRecord($('record-text').value);}
 catch(error){$('paste-error').textContent=error instanceof SyntaxError?'The pasted JSON is invalid. Use the plain-text template or paste valid JSON.':error.message;return;}
 $('paste-dialog').close();
 openEditor(undefined,draft);
 if(duplicates(draft).length)$('notice').textContent='Possible duplicate. Close this form and open the existing role if you meant to edit it.';
};
$('add').onclick=()=>openEditor();
$('results').onclick=e=>{if(e.target.dataset.edit)openEditor(e.target.dataset.edit);};
$('results').onchange=e=>{const id=e.target.dataset.select;if(id){e.target.checked?selected.add(id):selected.delete(id);render();$('results').querySelector('[data-select="'+CSS.escape(id)+'"]')?.focus();}};
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).close());
$('compare').onclick=()=>{
 const picked=rows.filter(r=>selected.has(r.id));
 $('matrix').innerHTML='<div class="table"><table><thead><tr><th scope="col">Field</th>'+picked.map(r=>'<th scope="col">'+esc(r.title)+'<span class="muted">'+esc(r.employer)+'</span></th>').join('')+'</tr></thead><tbody>'+schema.filter(([k])=>!['employer','title'].includes(k)).map(([k,label,type])=>'<tr><th scope="row">'+label+'</th>'+picked.map(r=>'<td>'+esc(type==='date'?date(r[k]):r[k]||'Unknown')+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
 $('comparison').showModal();
};
$('export').onclick=()=>{
 const url=URL.createObjectURL(new Blob([JSON.stringify(rows,null,2)],{type:'application/json'}));
 const a=document.createElement('a');a.href=url;a.download='career-pipeline-'+today()+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
$('import').onclick=()=>$('file').click();
$('file').onchange=async e=>{
 const file=e.target.files[0];e.target.value='';if(!file)return;
 try{
  const data=JSON.parse(await file.text());
  if(!Array.isArray(data))throw Error();
  const incoming=data.map(migrate).map(item=>{
   if(!item||typeof item.id!=='string'||!item.id)throw Error();
   const row={id:item.id};
   for(const [k,,type] of schema){
    const v=item[k]??defaults[k];
    if(typeof v!=='string'||(Array.isArray(type)&&!type.includes(v))||(type==='date'&&v&&(!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v))))||(type==='number'&&v&&!/^(100|[1-9]?[0-9])$/.test(v)))throw Error();
    row[k]=v;
   }
   return row;
  });
  if(new Set(incoming.map(r=>r.id)).size!==incoming.length||incoming.some(r=>issue(r,incoming)))throw Error();
  if(confirm('Replace the '+rows.length+' current records with '+incoming.length+' backed-up records?')){persist(incoming);selected.clear();render();}
 }catch{alert('This backup could not be restored. Check its format and application evidence.');}
};
render();
(function addFromLink(){
 const p=new URLSearchParams(location.search);
 if(p.get('add')!=='1')return;
 history.replaceState(null,'',location.pathname);
 const draft={...defaults,employer:p.get('employer')||'',title:p.get('title')||'',location:p.get('location')||'',url:p.get('url')||'',market:'UK'};
 const fit=p.get('fit'); if(/^(100|[1-9]?[0-9])$/.test(fit||''))draft.fit=fit;
 const existing=duplicates({...draft,id:''});
 if(existing.length){openEditor(existing[0].id);$('notice').textContent='You are already tracking this role.';return;}
 openEditor(undefined,draft);
 $('notice').textContent='Added from SponsorLive. The company holds a sponsor licence; confirm sponsorship for this specific role with the recruiter.';
})();
