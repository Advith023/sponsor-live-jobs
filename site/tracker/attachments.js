// Per-role CV / cover letter storage. Nothing leaves the device:
// - If the person picks a folder (Chrome/Edge on a computer), files are written to
//   <folder>/<Company - Role>/<original file name> and the tracker only remembers where.
// - Otherwise the file is kept in this browser's own storage (IndexedDB).
let attachmentRole;
let attachmentDb;
let folderHandle = null;
const canUseFolders = 'showDirectoryPicker' in window;

function openAttachmentDb() {
 if (!attachmentDb) attachmentDb = new Promise((resolve, reject) => {
  const request = indexedDB.open('career-pipeline-attachments', 2);
  request.onupgradeneeded = event => {
   const db = request.result;
   if (event.oldVersion < 1) db.createObjectStore('files', {keyPath:'id'}).createIndex('roleId', 'roleId');
   if (event.oldVersion < 2) db.createObjectStore('settings');
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
 }).catch(error => { attachmentDb = undefined; throw error; });
 return attachmentDb;
}

async function dbOperation(storeName, mode, operation) {
 const database = await openAttachmentDb();
 return new Promise((resolve, reject) => {
  const transaction = database.transaction(storeName, mode);
  const request = operation(transaction.objectStore(storeName));
  transaction.oncomplete = () => resolve(request.result);
  transaction.onabort = () => reject(transaction.error);
 });
}
const attachmentOperation = (mode, operation) => dbOperation('files', mode, operation);

// ---- folder handling
async function loadFolder() {
 if (!canUseFolders) return;
 try { folderHandle = await dbOperation('settings', 'readonly', s => s.get('folder')) || null; } catch { folderHandle = null; }
 showFolderStatus();
}
function showFolderStatus() {
 $('folder-pick').hidden = !canUseFolders;
 $('folder-forget').hidden = !folderHandle;
 $('folder-pick').textContent = folderHandle ? 'Change folder' : 'Save files to a folder on this computer';
 $('folder-status').textContent = folderHandle
  ? 'New files are saved to your folder “' + folderHandle.name + '”, in a sub-folder for each role.'
  : canUseFolders ? 'Files are kept in this browser on this device. You can save them to a folder instead.'
  : 'Files are kept in this browser on this device.';
}
async function folderAllowed(handle, ask) {
 const opts = {mode:'readwrite'};
 if (await handle.queryPermission(opts) === 'granted') return true;
 return ask && await handle.requestPermission(opts) === 'granted';
}
const safeName = text => String(text || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Untitled';
const roleFolderName = role => safeName(role.employer + ' - ' + role.title);

async function freeFileName(dir, name) {
 const dot = name.lastIndexOf('.');
 const base = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : '';
 for (let n = 1; n < 100; n++) {
  const candidate = n === 1 ? name : base + ' (' + n + ')' + ext;
  try { await dir.getFileHandle(candidate); } catch { return candidate; }
 }
 return base + ' ' + Date.now() + ext;
}

async function writeToFolder(role, file) {
 const dir = await folderHandle.getDirectoryHandle(roleFolderName(role), {create:true});
 const name = await freeFileName(dir, file.name);
 const handle = await dir.getFileHandle(name, {create:true});
 const writable = await handle.createWritable();
 await writable.write(file);
 await writable.close();
 return [roleFolderName(role), name];
}

async function readFromFolder(path) {
 if (!folderHandle || !await folderAllowed(folderHandle, true)) throw Error('Folder not available');
 const dir = await folderHandle.getDirectoryHandle(path[0]);
 return (await dir.getFileHandle(path[1])).getFile();
}

$('folder-pick').onclick = async () => {
 try {
  const handle = await window.showDirectoryPicker({id:'sponsorlive-applications', mode:'readwrite'});
  if (!await folderAllowed(handle, true)) throw Error();
  await dbOperation('settings', 'readwrite', s => s.put(handle, 'folder'));
  folderHandle = handle;
  showFolderStatus();
  $('attach-message').textContent = 'Folder connected. New files will be saved there.';
 } catch (error) {
  if (error?.name !== 'AbortError') $('attach-message').textContent = 'Could not use that folder. Try another one, such as Documents.';
 }
};
$('folder-forget').onclick = async () => {
 await dbOperation('settings', 'readwrite', s => s.delete('folder'));
 folderHandle = null;
 showFolderStatus();
 $('attach-message').textContent = 'Stopped using the folder. Files already saved there are untouched.';
};

// ---- list, open, remove
function openBlob(file, name) {
 const url = URL.createObjectURL(file);
 const link = document.createElement('a');
 link.href = url;
 link.download = name;
 link.click();
 setTimeout(() => URL.revokeObjectURL(url), 30000);
}

async function showAttachments(roleId) {
 const files = await attachmentOperation('readonly', store => store.index('roleId').getAll(roleId));
 if (attachmentRole !== roleId) return;
 $('attach-list').replaceChildren();
 if (!files.length) {
  const item = document.createElement('li');
  item.textContent = 'No attachments yet.';
  $('attach-list').append(item);
 }
 for (const entry of files.sort((a,b) => b.created-a.created)) {
  const item = document.createElement('li');
  const name = entry.file ? entry.file.name : entry.path[1];
  const when = new Date(entry.created).toLocaleDateString('en-GB', {day:'numeric', month:'short', year:'numeric'});
  item.textContent = entry.type + ' · ' + name + ' · ' + when + (entry.path ? ' · in folder “' + entry.path[0] + '”' : ' · in this browser') + ' ';
  const open = document.createElement('button');
  open.type = 'button';
  open.textContent = 'Download';
  open.onclick = async () => {
   try { openBlob(entry.file || await readFromFolder(entry.path), name); }
   catch { $('attach-message').textContent = 'Could not open it. Check the file is still in your folder and that the folder is connected.'; }
  };
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.textContent = 'Remove';
  remove.onclick = async () => {
   if (!confirm(entry.path ? 'Remove this from the tracker? The file stays in your folder.' : 'Delete this file from this browser?')) return;
   await attachmentOperation('readwrite', store => store.delete(entry.id));
   await showAttachments(roleId);
  };
  item.append(open, remove);
  $('attach-list').append(item);
 }
}

$('results').addEventListener('click', async event => {
 const role = rows.find(row => row.id === event.target.dataset.attachments);
 if (!role) return;
 attachmentRole = role.id;
 $('attachment-role').textContent = role.employer + ' · ' + role.title;
 $('attach-form').reset();
 $('attach-message').textContent = '';
 $('attach-list').replaceChildren();
 showFolderStatus();
 $('attachments').showModal();
 try { await showAttachments(role.id); }
 catch { if (attachmentRole === role.id) $('attach-message').textContent = 'Could not read attachments in this browser.'; }
});

$('attach-form').onsubmit = async event => {
 event.preventDefault();
 const file = $('attach-file').files[0];
 if (!file || !/\.(pdf|docx)$/i.test(file.name) || !file.size || file.size > 20_000_000) {
  $('attach-message').textContent = 'Choose a PDF or DOCX file up to 20 MB.';
  return;
 }
 const roleId = attachmentRole;
 const role = rows.find(row => row.id === roleId);
 const button = event.submitter;
 button.disabled = true;
 try {
  const entry = {id: crypto.randomUUID(), roleId, type: $('attach-type').value, created: Date.now()};
  let where = 'in this browser';
  if (folderHandle && await folderAllowed(folderHandle, true)) {
   entry.path = await writeToFolder(role, file);
   where = 'to your folder in “' + entry.path[0] + '”';
  } else {
   entry.file = file;
  }
  await attachmentOperation('readwrite', store => store.add(entry));
  if (attachmentRole !== roleId) return;
  $('attach-file').value = '';
  $('attach-message').textContent = 'Saved ' + where + '.';
  await showAttachments(roleId);
 } catch {
  if (attachmentRole === roleId) $('attach-message').textContent = 'Could not save the file. Reopen this role to check its saved files.';
 } finally {
  button.disabled = false;
 }
};

loadFolder();
