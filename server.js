const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const PORT = Number(process.env.PORT || 3000);
const HOST = "0.0.0.0";
const publicDir = path.join(__dirname, "public");

const mime = {
  ".html":"text/html; charset=utf-8",".js":"application/javascript; charset=utf-8",
  ".css":"text/css; charset=utf-8",".json":"application/json; charset=utf-8",
  ".png":"image/png",".jpg":"image/jpeg",".svg":"image/svg+xml"
};

const server = http.createServer((req,res)=>{
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if (url.pathname === "/health") {
    res.writeHead(200, {"Content-Type":"text/plain; charset=utf-8"});
    return res.end("ok");
  }
  let file = url.pathname === "/" ? "/index.html" : url.pathname;
  file = path.normalize(file).replace(/^(\.\.[\/\\])+/, "");
  const full = path.join(publicDir,file);
  if (!full.startsWith(publicDir)) { res.writeHead(403); return res.end("Forbidden"); }
  fs.readFile(full,(err,data)=>{
    if(err){res.writeHead(404,{"Content-Type":"text/plain"});return res.end("Not found");}
    res.writeHead(200,{"Content-Type":mime[path.extname(full)]||"application/octet-stream"});
    res.end(data);
  });
});

const wss = new WebSocket.Server({server});
const rooms = new Map();

function makeId(){ return Math.random().toString(36).slice(2,8).toUpperCase(); }
function cleanRoom(room){
  for(const [id,p] of room.players) if(p.ws.readyState !== WebSocket.OPEN) room.players.delete(id);
  if(room.players.size===0) rooms.delete(room.code);
}
function send(ws,obj){ if(ws.readyState===WebSocket.OPEN) ws.send(JSON.stringify(obj)); }
function state(room){
  return {type:"state", players:[...room.players.values()].map(p=>({
    id:p.id,x:p.x,y:p.y,vx:p.vx,vy:p.vy,hp:p.hp,dir:p.dir,
    action:p.action,stun:p.stun,guard:p.guard,ground:p.ground
  }))};
}
function broadcast(room){ const msg=JSON.stringify(state(room)); for(const p of room.players.values()) if(p.ws.readyState===WebSocket.OPEN)p.ws.send(msg); }

wss.on("connection",ws=>{
  let room=null, player=null;
  ws.on("message",raw=>{
    let m; try{m=JSON.parse(raw)}catch{return}
    if(m.type==="join"){
      const code=String(m.room||"").trim().toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,8)||makeId();
      room=rooms.get(code);
      if(!room){room={code,players:new Map(),created:Date.now()};rooms.set(code,room);}
      if(room.players.size>=2) return send(ws,{type:"error",message:"Phòng đã đủ 2 người"});
      player={id:makeId(),ws,x:room.players.size?760:240,y:430,vx:0,vy:0,hp:100,dir:room.players.size?-1:1,action:"idle",stun:0,guard:false,ground:true,cool:0};
      room.players.set(player.id,player);
      send(ws,{type:"joined",room:code,id:player.id,slot:room.players.size});
      broadcast(room); return;
    }
    if(!room||!player)return;
    if(m.type==="input"){ player.left=!!m.left;player.right=!!m.right;player.jump=!!m.jump;player.guard=!!m.guard;player.attack=m.attack||null; }
    if(m.type==="restart"){ for(const p of room.players.values()){p.hp=100;p.x=p.id=== [...room.players.keys()][0]?240:760;p.y=430;p.vx=p.vy=0;p.action="idle";p.stun=0;p.cool=0;} broadcast(room);}
  });
  ws.on("close",()=>{ if(room&&player){room.players.delete(player.id);broadcast(room);cleanRoom(room);} });
});

setInterval(()=>{
  for(const room of rooms.values()){
    const ps=[...room.players.values()];
    for(const p of ps){
      if(p.cool>0)p.cool--; if(p.stun>0)p.stun--;
      p.action="idle";
      if(p.stun===0){
        if(p.left)p.vx=Math.max(p.vx-.8,-5);
        if(p.right)p.vx=Math.min(p.vx+.8,5);
        if(!p.left&&!p.right)p.vx*=.82;
        if(p.jump&&p.ground){p.vy=-12;p.ground=false;}
        if(p.guard)p.action="guard";
        if(p.attack && p.cool===0 && !p.guard){
          const a=p.attack; p.action=a;p.cool=a==="grab"?38:24;
          const target=ps.find(q=>q.id!==p.id && Math.abs(q.x-p.x)<115 && Math.abs(q.y-p.y)<75);
          if(target){
            let dmg=a==="punch"?8:a==="kick"?11:18;
            if(target.guard)dmg=Math.ceil(dmg*.25);
            target.hp=Math.max(0,target.hp-dmg);
            target.stun=a==="grab"?14:8;
            target.vx+=(p.dir)* (a==="grab"?8:5);
            target.vy=-5;
            if(target.hp===0)target.action="ko";
          }
        }
      }
      p.vy+=.65;p.x+=p.vx;p.y+=p.vy;
      if(p.y>=430){p.y=430;p.vy=0;p.ground=true;} else p.ground=false;
      p.x=Math.max(50,Math.min(950,p.x));
      if(Math.abs(p.vx)>.2)p.dir=p.vx>0?1:-1;
      if(p.hp<=0)p.action="ko";
    }
    broadcast(room);
  }
},1000/30);

server.listen(PORT,HOST,()=>console.log(`Wrestle Arena listening on ${HOST}:${PORT}`));
