import * as THREE from 'three';
import { CSS3DObject, CSS3DRenderer } from 'three/addons/renderers/CSS3DRenderer.js';
import { TrackballControls } from 'three/addons/controls/TrackballControls.js';
import * as TWEEN from 'three/addons/libs/tween.module.js';

const CONFIG = {
  // Replace with your OAuth 2.0 Web client ID from Google Cloud Console.
  GOOGLE_CLIENT_ID: '549551274358-dak6f70ms56m5dja5ks039o6pmqb6kd7.apps.googleusercontent.com',
  SHEET_CSV_URL: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vToOhRXajZQ5rGoVAysWwQNWnmfDv8Op3aWHmtkydi4SS0Ul-3pNoo9N9ngEz6GR8mpmbjB1I0LvlBZ/pub?gid=513770450&single=true&output=csv',
  EXPECTED_PROFILE_COUNT: 200
};

const byId = (id) => document.getElementById(id);
const appState = { user: null, people: [], objects: [], renderer: null, camera: null, scene: null, controls: null, activeLayout: 'table', animating: false };

function setAuthMessage(message, error = false) {
  const el = byId('authMessage');
  el.textContent = message;
  el.style.color = error ? '#ff9785' : '';
}

window.initializeGoogleSignIn = () => {
  if (!window.google?.accounts?.id) return;
  if (CONFIG.GOOGLE_CLIENT_ID.startsWith('YOUR_')) {
    setAuthMessage('Add your Google OAuth client ID in app.js to enable Google Sign-In.', true);
    return;
  }
  window.google.accounts.id.initialize({
    client_id: CONFIG.GOOGLE_CLIENT_ID,
    callback: handleGoogleCredential,
    auto_select: false,
    cancel_on_tap_outside: true
  });
  byId('googleButton').replaceChildren();
  window.google.accounts.id.renderButton(byId('googleButton'), {
    type: 'standard', theme: 'filled_blue', size: 'large', text: 'signin_with',
    shape: 'rectangular', logo_alignment: 'left', width: 300
  });
  setAuthMessage('Sign in with your Google account to continue.');
};

function decodeCredential(token) {
  const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(decodeURIComponent(Array.from(atob(payload), (c) => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`).join('')));
}

function handleGoogleCredential(response) {
  try {
    const claims = decodeCredential(response.credential);
    appState.user = { name: claims.name || claims.given_name || 'Google user', email: claims.email || '', picture: claims.picture || '' };
    byId('loginView').hidden = true;
    byId('appView').hidden = false;
    byId('userName').textContent = (appState.user.name || 'SIGNED IN').toUpperCase();
    byId('userAvatar').src = appState.user.picture;
    loadProfiles();
  } catch (error) {
    console.error('Google credential could not be read:', error);
    setAuthMessage('Sign-in could not be completed. Please try again.', true);
  }
}

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  const source = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((cell) => cell.trim() !== '')) rows.push(row);
      row = [];
    } else field += char;
  }
  row.push(field);
  if (row.some((cell) => cell.trim() !== '')) rows.push(row);
  if (rows.length < 2) throw new Error('The CSV has no profile rows. Check the published sheet and try again.');
  const headers = rows.shift().map((value) => value.trim().toLowerCase());
  const index = (...names) => headers.findIndex((header) => names.includes(header.replace(/[^a-z]/g, '')));
  const columns = {
    name: index('name'), photo: index('photo', 'image', 'avatar'), age: index('age'),
    country: index('country'), interest: index('interest', 'title', 'role'), worth: index('networth', 'worth', 'networthusd')
  };
  if (columns.name < 0 || columns.worth < 0) throw new Error('Required columns not found. Include Name and Net Worth in the first row.');
  return rows.map((cells, i) => {
    const get = (key) => columns[key] < 0 ? '' : (cells[columns[key]] || '').trim();
    const worth = parseFloat(get('worth').replace(/[^\d.-]/g, ''));
    return {
      id: i + 1, name: get('name') || `Profile ${i + 1}`, photo: get('photo'), age: get('age'),
      country: get('country'), interest: get('interest') || '—', worth: Number.isFinite(worth) ? worth : 0
    };
  }).filter((person) => person.name);
}

function sheetCsvUrl(value) {
  const url = value.trim();
  if (!url) return '';
  if (!/^https:\/\/docs\.google\.com\/spreadsheets\//i.test(url) && !/^https:\/\/.*\.googleusercontent\.com\//i.test(url)) {
    throw new Error('Paste a Google Sheets published CSV URL beginning with https://docs.google.com/spreadsheets/.');
  }
  return url;
}

function money(value) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
}

function worthColor(value) {
  if (value < 100000) return '#EF3022';
  if (value <= 200000) return '#F39A27';
  return '#2DA76E';
}

async function loadProfiles(source = null) {
  const message = byId('sceneMessage');
  message.hidden = false;
  message.innerHTML = '<div><b>Loading profiles…</b><br />Fetching the latest rows from your data source.</div>';
  byId('datasetStatus').textContent = 'FETCHING SHEET DATA';
  try {
    const savedUrl = localStorage.getItem('people-atlas-sheet-url') || '';
    const selectedUrl = typeof source === 'string' ? sheetCsvUrl(source) : (savedUrl || sheetCsvUrl(CONFIG.SHEET_CSV_URL));
    const response = await fetch(selectedUrl, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Data request failed (${response.status}). Check that the sheet is published to the web as CSV and is publicly readable.`);
    const text = await response.text();
    const people = parseCsv(text);
    if (!people.length) throw new Error('No valid profile rows were found in the CSV.');
    appState.people = people;
    byId('profileCount').textContent = String(people.length).padStart(3, '0');
    byId('datasetStatus').textContent = 'GOOGLE SHEET CONNECTED';
    message.hidden = true;
    initializeScene();
  } catch (error) {
    console.error(error);
    byId('datasetStatus').textContent = 'DATA SOURCE NEEDS ATTENTION';
    message.innerHTML = `<div><b>Could not load the profiles.</b><br />${escapeHtml(error.message)}<br /><br />Open <b>Data Source</b> to add a published Google Sheets CSV link.</div>`;
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function initials(name) {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0] || '').join('').toUpperCase();
}

function makeCard(person) {
  const element = document.createElement('article');
  element.className = 'person-card';
  element.tabIndex = 0;
  element.setAttribute('role', 'button');
  element.setAttribute('aria-label', `${person.name}, net worth ${money(person.worth)}`);
  element.style.setProperty('--worth', worthColor(person.worth));
  const safeName = escapeHtml(person.name);
  const photo = person.photo ? `<img src="${escapeHtml(person.photo)}" alt="${safeName}" referrerpolicy="no-referrer" />` : `<div class="photo-fallback">${escapeHtml(initials(person.name))}</div>`;
  element.innerHTML = `<div class="card-photo">${photo}<span class="card-index">${String(person.id).padStart(3, '0')}</span><span class="card-worth">${escapeHtml(money(person.worth))}</span></div><div class="card-body"><div class="card-name">${safeName}</div><div class="card-subline"><span>${escapeHtml(person.age ? `${person.age} YEARS` : 'AGE N/A')}</span><span>${escapeHtml(person.country || '—')}</span></div><div class="card-interest">${escapeHtml(person.interest)}</div><span class="card-country">PROFILE</span></div><div class="card-rule"></div>`;
  const open = () => showProfile(person);
  element.addEventListener('click', open);
  element.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); } });
  const object = new CSS3DObject(element);
  object.userData.person = person;
  return object;
}

function initializeScene() {
  const host = byId('scene');
  if (appState.renderer) {
    appState.controls?.dispose();
    appState.renderer.domElement.remove();
    appState.renderer = null;
    appState.objects = [];
  }
  const width = Math.max(host.clientWidth, 1), height = Math.max(host.clientHeight, 1);
  appState.scene = new THREE.Scene();
  appState.camera = new THREE.PerspectiveCamera(45, width / height, 1, 20000);
  appState.camera.position.set(0, 0, 5200);
  appState.renderer = new CSS3DRenderer();
  appState.renderer.setSize(width, height);
  host.appendChild(appState.renderer.domElement);
  appState.controls = new TrackballControls(appState.camera, appState.renderer.domElement);
  appState.controls.rotateSpeed = 1.15;
  appState.controls.zoomSpeed = 1.15;
  appState.controls.panSpeed = 0.7;
  appState.controls.staticMoving = false;
  appState.controls.dynamicDampingFactor = 0.12;
  appState.objects = appState.people.map((person) => {
    const object = makeCard(person);
    appState.scene.add(object);
    return object;
  });
  window.addEventListener('resize', handleResize);
  if (!appState.animating) animate();
  transform('table', 0);
}

function handleResize() {
  if (!appState.camera || !appState.renderer) return;
  const host = byId('scene');
  appState.camera.aspect = Math.max(host.clientWidth, 1) / Math.max(host.clientHeight, 1);
  appState.camera.updateProjectionMatrix();
  appState.renderer.setSize(host.clientWidth, host.clientHeight);
  appState.controls?.handleResize();
}

function animate() {
  appState.animating = true;
  requestAnimationFrame(animate);
  TWEEN.update();
  appState.controls?.update();
  if (appState.scene && appState.camera && appState.renderer) appState.renderer.render(appState.scene, appState.camera);
}

function makeLayouts(count) {
  const table = [], sphere = [], helix = [], grid = [];
  const tableCols = 20, tableRows = 10, tableX = 224, tableY = 278;
  for (let i = 0; i < count; i++) {
    const col = i % tableCols, row = Math.floor(i / tableCols);
    const tablePos = new THREE.Vector3((col - (tableCols - 1) / 2) * tableX, ((tableRows - 1) / 2 - row) * tableY, 0);
    table.push({ position: tablePos, rotation: new THREE.Euler(0, 0, 0) });

    const phi = Math.acos(-1 + (2 * i) / count);
    const theta = Math.sqrt(count * Math.PI) * phi;
    const spherePos = new THREE.Vector3(1220 * Math.cos(theta) * Math.sin(phi), 1220 * Math.sin(theta) * Math.sin(phi), 1220 * Math.cos(phi));
    sphere.push({ position: spherePos, rotation: new THREE.Euler(0, 0, 0) });

    const strand = i % 2;
    const step = Math.floor(i / 2);
    const angle = step * 0.29 + strand * Math.PI;
    const helixPos = new THREE.Vector3(790 * Math.cos(angle), (step - Math.ceil(count / 2) / 2) * 27, 790 * Math.sin(angle));
    helix.push({ position: helixPos, rotation: new THREE.Euler(0, -angle + Math.PI / 2, 0) });

    const x = i % 5, y = Math.floor(i / 5) % 4, z = Math.floor(i / 20);
    const gridPos = new THREE.Vector3((x - 2) * 255, (1.5 - y) * 310, (z - 4.5) * 265);
    grid.push({ position: gridPos, rotation: new THREE.Euler(0, 0, 0) });
  }
  return { table, sphere, helix, grid };
}

const layouts = { table: null, sphere: null, helix: null, grid: null };
function transform(layout, duration = 1700) {
  if (!appState.objects.length || !appState.camera) return;
  if (!layouts[layout] || layouts[layout].length !== appState.objects.length) {
    const all = makeLayouts(appState.objects.length);
    Object.assign(layouts, all);
  }
  const targets = layouts[layout];
  const cameraZ = { table: 5200, sphere: 3400, helix: 3900, grid: 3700 }[layout];
  appState.objects.forEach((object, index) => {
    const target = targets[index];
    new TWEEN.Tween(object.position).to({ x: target.position.x, y: target.position.y, z: target.position.z }, duration).easing(TWEEN.Easing.Exponential.InOut).start();
    new TWEEN.Tween(object.rotation).to({ x: target.rotation.x, y: target.rotation.y, z: target.rotation.z }, duration).easing(TWEEN.Easing.Exponential.InOut).start();
  });
  new TWEEN.Tween(appState.camera.position).to({ x: 0, y: 0, z: cameraZ }, duration).easing(TWEEN.Easing.Exponential.InOut).start();
  appState.activeLayout = layout;
  document.querySelectorAll('.view-button').forEach((button) => button.classList.toggle('active', button.dataset.layout === layout));
  byId('currentLayout').textContent = `${layout === 'helix' ? 'DOUBLE HELIX' : layout.toUpperCase()} VIEW`;
  byId('viewerHint').textContent = 'DRAG TO ORBIT  ·  SCROLL TO ZOOM';
}

function showProfile(person) {
  byId('dialogName').textContent = person.name;
  byId('dialogMeta').textContent = [person.age ? `${person.age} YEARS OLD` : '', person.country].filter(Boolean).join(' · ') || 'PROFILE';
  byId('dialogWorth').textContent = money(person.worth);
  byId('dialogWorth').style.color = worthColor(person.worth);
  byId('dialogInterest').textContent = person.interest;
  const image = byId('dialogImage');
  image.innerHTML = person.photo ? `<img src="${escapeHtml(person.photo)}" alt="${escapeHtml(person.name)}" referrerpolicy="no-referrer" />` : `<div class="dialog-fallback">${escapeHtml(initials(person.name))}</div>`;
  byId('profileDialog').hidden = false;
}

function closeDialog(dialog) { dialog.hidden = true; }

document.querySelectorAll('.view-button').forEach((button) => button.addEventListener('click', () => transform(button.dataset.layout)));
byId('signOutButton').addEventListener('click', () => {
  appState.user = null;
  byId('appView').hidden = true;
  byId('loginView').hidden = false;
  if (window.google?.accounts?.id) window.google.accounts.id.disableAutoSelect();
});
byId('sourceButton').addEventListener('click', () => {
  byId('sheetUrl').value = localStorage.getItem('people-atlas-sheet-url') || CONFIG.SHEET_CSV_URL;
  byId('sourceMessage').textContent = '';
  byId('sourceDialog').hidden = false;
});
byId('saveSourceButton').addEventListener('click', async () => {
  try {
    const url = sheetCsvUrl(byId('sheetUrl').value);
    if (!url) throw new Error('Paste the published CSV link.');
    localStorage.setItem('people-atlas-sheet-url', url);
    byId('sourceDialog').hidden = true;
    await loadProfiles(url);
  } catch (error) { byId('sourceMessage').textContent = error.message; }
});
byId('useLocalButton').addEventListener('click', async () => {
  localStorage.removeItem('people-atlas-sheet-url');
  byId('sourceDialog').hidden = true;
  await loadProfiles();
});
document.querySelectorAll('.dialog-close').forEach((button) => button.addEventListener('click', () => closeDialog(button.closest('.dialog-backdrop'))));
document.querySelectorAll('.dialog-backdrop').forEach((backdrop) => backdrop.addEventListener('click', (event) => { if (event.target === backdrop) closeDialog(backdrop); }));
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') document.querySelectorAll('.dialog-backdrop').forEach((dialog) => closeDialog(dialog)); });
if (window.google?.accounts?.id) window.initializeGoogleSignIn();

// Profile rows are fetched live from the published Google Sheet CSV.
