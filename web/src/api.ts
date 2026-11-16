export async function requestJSON(url:string,init?:RequestInit){
 const response=await fetch(url,init),data=await response.json();
 if(!response.ok)throw new Error(`${data.error??'Request failed'}${data.issues?': '+data.issues.map((i:{path:unknown[];message:string})=>`${i.path.join('.')}: ${i.message}`).join('; '):''}`);
 return data;
}
export const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export const actingHeaders=(actor:string,token:string)=>({'x-actor':actor,...(token?{authorization:`Bearer ${token}`}:{})});
