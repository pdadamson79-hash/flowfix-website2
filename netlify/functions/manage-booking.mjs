import { getStore } from "@netlify/blobs";

const headers={"content-type":"application/json","cache-control":"no-store"};
function hmToMin(hm){const [h,m]=hm.split(":").map(Number);return h*60+m}
function compact(v){return `${String(Math.floor(v/60)).padStart(2,"0")}${String(v%60).padStart(2,"0")}`}
function workingWindow(dateStr){
  const d=new Date(`${dateStr}T12:00:00+02:00`);
  const day=d.getDay();
  if(day===0||day===6) return null;
  return day===5?[570,960]:[570,1080];
}
function overlaps(a0,a1,b0,b1){return a0<b1&&b0<a1}
async function listDate(store,date){
  const r=await store.list({prefix:`slot:${date}:`});
  return r.blobs||[];
}
async function free(store,date,start,end,ignoreKey){
  const blobs=await listDate(store,date);
  for(const blob of blobs){
    if(blob.key===ignoreKey) continue;
    const p=blob.key.split(":");
    if(p.length<6) continue;
    const b0=Number(p[2].slice(0,2))*60+Number(p[2].slice(2));
    const b1=Number(p[3].slice(0,2))*60+Number(p[3].slice(2));
    if(overlaps(start,end,b0,b1)) return false;
  }
  return true;
}

export default async (req)=>{
  try{
    if(req.method!=="POST") return new Response(JSON.stringify({error:"POST only"}),{status:405,headers});
    const expected=process.env.FLOWFIX_ADMIN_KEY;
    const supplied=req.headers.get("x-flowfix-admin-key");
    if(!expected||!supplied||supplied!==expected){
      return new Response(JSON.stringify({error:"unauthorized"}),{status:401,headers});
    }

    const body=await req.json();
    const store=getStore({name:"confirmed-bookings",consistency:"strong"});

    if(body.action==="release"){
      if(body.key) await store.delete(body.key);
      return new Response(JSON.stringify({ok:true}),{headers});
    }

    const {date,time,duration=60,reference="BOOKING"}=body;
    const win=workingWindow(date);
    if(!win) return new Response(JSON.stringify({error:"closed day"}),{status:400,headers});

    const start=hmToMin(time), end=start+Number(duration);
    if(start<win[0]||end>win[1]){
      return new Response(JSON.stringify({error:"outside working hours"}),{status:400,headers});
    }

    const ignore=body.action==="move"?body.oldKey:null;
    if(!(await free(store,date,start,end,ignore))){
      return new Response(JSON.stringify({error:"slot no longer available"}),{status:409,headers});
    }

    if(body.action==="move" && body.oldKey) await store.delete(body.oldKey);

    const safeRef=String(reference).replace(/[^A-Za-z0-9_-]/g,"").slice(0,40);
    const key=`slot:${date}:${compact(start)}:${compact(end)}:${safeRef}`;
    const result=await store.setJSON(key,{
      date,time,duration:Number(duration),reference,status:"CONFIRMED",updatedAt:new Date().toISOString()
    },{onlyIfNew:true});
    if(!result.modified){
      return new Response(JSON.stringify({error:"slot already exists"}),{status:409,headers});
    }
    return new Response(JSON.stringify({ok:true,key}),{headers});
  }catch(err){
    return new Response(JSON.stringify({error:"booking update failed"}),{status:500,headers});
  }
};
