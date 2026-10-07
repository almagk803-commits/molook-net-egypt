const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const url = require('url');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || '1234';
const ROOT = __dirname;
const const PUBLIC = ROOT;
const DB = path.join(ROOT, 'data.json');

let db = { nextNumber: 1, orders: [] };
try { db = JSON.parse(fs.readFileSync(DB,'utf8')); } catch(e) {}
if (!db || !Array.isArray(db.orders)) db={nextNumber:1,orders:[]};
if (!Number.isInteger(db.nextNumber) || db.nextNumber < 1) db.nextNumber = db.orders.reduce((m,o)=>Math.max(m,Number(o.orderNo)||0),0)+1;

const tokens = new Map();

function persist(){ fs.writeFileSync(DB, JSON.stringify(db,null,2), 'utf8'); }
function json(res,status,data){
  const body=JSON.stringify(data);
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Origin':'*','Cache-Control':'no-store'});
  res.end(body);
}
function body(req){
  return new Promise((resolve,reject)=>{
    let s=''; req.on('data',c=>s+=c); req.on('end',()=>{try{resolve(s?JSON.parse(s):{})}catch(e){reject(e)}}); req.on('error',reject);
  });
}
function adminOK(req){
  const h=req.headers.authorization||'';
  if(!h.startsWith('Bearer ')) return false;
  return tokens.has(h.slice(7));
}
function safePath(p){
  const target=path.normalize(path.join(PUBLIC,p));
  return target.startsWith(PUBLIC);
}
function sendFile(res,file){
  const ext=path.extname(file).toLowerCase();
  const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml'};
  fs.readFile(file,(err,data)=>{if(err){res.writeHead(404);res.end('Not found');return}res.writeHead(200,{'Content-Type':types[ext]||'application/octet-stream','Cache-Control':'no-cache'});res.end(data)});
}

const server=http.createServer(async(req,res)=>{
  try{
    if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type, Authorization','Access-Control-Allow-Methods':'GET,POST,PATCH,DELETE,OPTIONS'});return res.end()}
    const u=url.parse(req.url,true);
    if(u.pathname==='/api/health') return json(res,200,{ok:true,service:'molook-net'});
    if(u.pathname==='/api/admin/login' && req.method==='POST'){
      const b=await body(req);
      if(b.username!==ADMIN_USER || b.password!==ADMIN_PASS) return json(res,401,{error:'اسم المستخدم أو كلمة المرور غير صحيحة.'});
      const token=crypto.randomBytes(24).toString('hex'); tokens.set(token,Date.now()+8*60*60*1000);
      return json(res,200,{token});
    }
    for(const [t,exp] of tokens){if(exp<Date.now())tokens.delete(t)}
    if(u.pathname==='/api/orders' && req.method==='GET'){
      let orders=db.orders.slice().sort((a,b)=>Number(b.orderNo)-Number(a.orderNo));
      if(u.query.phone) orders=orders.filter(o=>o.phone===u.query.phone);
      return json(res,200,{orders,total:db.orders.length});
    }
    if(u.pathname==='/api/orders' && req.method==='POST'){
      const b=await body(req);
      if(!b.phone || !b.network || !b.service) return json(res,400,{error:'بيانات الطلب ناقصة.'});
      const orderNo=String(db.nextNumber++);
      const order={
        ...b, orderNo, orderNumber:orderNo, createdAt:new Date().toISOString(),
        status:b.status||'قيد المراجعة',
        history:[{status:b.status||'قيد المراجعة',at:new Date().toISOString(),note:'تم إنشاء الطلب من موقع العملاء'}]
      };
      delete order.id;
      db.orders.push(order); persist();
      return json(res,201,{order,orders:db.orders.slice().sort((a,b)=>Number(b.orderNo)-Number(a.orderNo)),total:db.orders.length});
    }
    const m=u.pathname.match(/^\/api\/orders\/([^/]+)$/);
    if(m){
      const no=decodeURIComponent(m[1]), idx=db.orders.findIndex(o=>String(o.orderNo)===no);
      if(idx<0)return json(res,404,{error:'العملية غير موجودة.'});
      if(!adminOK(req))return json(res,401,{error:'غير مصرح.'});
      if(req.method==='PATCH'){
        const b=await body(req), o=db.orders[idx], old=o.status||'قيد المراجعة';
        if(b.status && b.status!==old)o.history=(Array.isArray(o.history)?o.history:[]).concat([{status:b.status,at:new Date().toISOString(),note:b.note||'تغيير الحالة من لوحة الإدارة'}]);
        if(b.status)o.status=b.status;
        if(typeof b.note==='string')o.note=b.note;
        o.updatedAt=new Date().toISOString();
        persist(); return json(res,200,{order:o});
      }
      if(req.method==='DELETE'){
        db.orders.splice(idx,1); persist(); return json(res,200,{ok:true,total:db.orders.length});
      }
    }
    if(u.pathname.startsWith('/api/')) return json(res,404,{error:'API endpoint not found'});
    let p=u.pathname==='/'?'/customer.html':u.pathname;
    if(!safePath(p))return json(res,403,{error:'Forbidden'});
    sendFile(res,path.join(PUBLIC,p));
  }catch(e){console.error(e);json(res,500,{error:'حدث خطأ داخلي في الخادم.'})}
});
server.listen(PORT,HOST,()=>console.log(`Molook platform running on http://${HOST}:${PORT}`));
