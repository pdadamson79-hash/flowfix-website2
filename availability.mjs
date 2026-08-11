import { getStore } from "@netlify/blobs";

const headers={"content-type":"application/json","cache-control":"no-store"};

function minToHm(v){return `${String(Math.floor(v/60)).padStart(2,"0")}:${String(v%60).padStart(2,"0")}`}
function workingWindow(dateStr){
  const d=new Date(`${dateStr}T12:00:00+02:00`);
  const day=d.getDay();
  if(day===0||day===6) return null;
  if(day===5) return [570,1080];   // Friday 09:30–18:00
  return [570,1080];              // Mon–Thu 09:30–18:00
}
function overlaps(a0,a1,b0,b1){return a0<b1 && b0<a1}

export default async (req)=>{
  try{
    const url=new URL(req.url);
    const date=url.searchParams.get("date");
    const duration=Math.max(30,Math.min(240,Number(url.searchParams.get("duration")||60)));
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date||"")){
      return new Response(JSON.stringify({error:"invalid date"}),{status:400,headers});
    }
    const window=workingWindow(date);
    if(!window) return new Response(JSON.stringify({closed:true,slots:[]}),{headers});

    const store=getStore({name:"confirmed-bookings",consistency:"strong"});
    const result=await store.list({prefix:`slot:${date}:`});
    const bookings=[];
    for(const blob of result.blobs||[]){
      const parts=blob.key.split(":");
      if(parts.length>=6){
        const start=Number(parts[2].slice(0,2))*60+Number(parts[2].slice(2));
        const end=Number(parts[3].slice(0,2))*60+Number(parts[3].slice(2));
        bookings.push([start,end]);
      }
    }

    const [open,close]=window;
    const slots=[];
    for(let start=open;start+duration<=close;start+=30){
      const end=start+duration;
      if(!bookings.some(([b0,b1])=>overlaps(start,end,b0,b1))) slots.push(minToHm(start));
    }
    return new Response(JSON.stringify({closed:false,slots}),{headers});
  }catch(err){
    return new Response(JSON.stringify({error:"availability failed"}),{status:500,headers});
  }
};