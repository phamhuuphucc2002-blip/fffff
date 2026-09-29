import fs from 'fs';
import path from 'path';

const htmlPath = path.join(process.cwd(), 'Arcanum_CloudSync.html');
if (!fs.existsSync(htmlPath)) {
  throw new Error(`Arcanum HTML not found: ${htmlPath}`);
}

let html = fs.readFileSync(htmlPath, 'utf8');
const broken = '<button class="btn primary data-export" id="exportAppBtn" disabled="">Đang đóng gói…</button>';
const fixed = '<button class="btn primary data-export" id="exportAppBtn" type="button">Xuất ứng dụng + dữ liệu</button>';

if (html.includes(broken)) {
  html = html.replace(broken, fixed);
  fs.writeFileSync(htmlPath, html, 'utf8');
  console.log('Arcanum export button patch applied.');
} else if (html.includes('id="exportAppBtn"') && !html.includes('id="exportAppBtn" disabled')) {
  console.log('Arcanum export button is already enabled; no patch needed.');
} else {
  throw new Error('Could not locate the Arcanum export button markup; refusing to modify the file.');
}
