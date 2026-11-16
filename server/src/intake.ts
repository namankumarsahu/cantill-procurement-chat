import {z} from 'zod';
import {Decimal} from 'decimal.js';
import {matchDescription,normalizeDescription} from '../../engine/src/matching.js';
import type {MasterData,Item} from '../../engine/src/types.js';
import type {Policy} from '../../engine/src/policy.js';
import {validDate,DAY_MS} from '../../engine/src/dates.js';
import {configured,structuredJSON} from './llm.js';
export const intakeSchema=z.strictObject({description:z.string().nullable(),quantity:z.string().nullable(),plant:z.string().nullable(),need_by_date:z.string().nullable(),urgency:z.enum(['Normal','Emergency']).nullable(),estimated_unit_price:z.string().nullable(),uom:z.string().nullable()});
export type IntakeFields=z.infer<typeof intakeSchema>;
export interface IntakeState{fields:IntakeFields;selected_item:string|null;force_new:boolean;stage:'collecting'|'confirmation'|'created'}
export const emptyIntake=():IntakeState=>({fields:{description:null,quantity:null,plant:null,need_by_date:null,urgency:null,estimated_unit_price:null,uom:null},selected_item:null,force_new:false,stage:'collecting'});
export type IntakeParser=(message:string,state:IntakeState,today:string)=>Promise<IntakeFields>;
export async function parseIntake(message:string,state:IntakeState,today:string):Promise<IntakeFields>{
 return intakeSchema.parse(await structuredJSON('purchase_request_fields',z.toJSONSchema(intakeSchema),[
  {role:'system',content:`Extract only purchase-request fields explicitly stated in the user's latest message. Missing fields must be null; do not invent quantity, item specifications, plant, date, urgency or price. Never output item codes, supplier choices or procurement routes. Existing conversation fields are ${JSON.stringify(state.fields)}. Today's business date is ${today}. Resolve explicit relative dates such as tomorrow/next Friday; urgent does not mean Emergency unless the user explicitly chooses Emergency. Quantity and unit price are decimal strings; dates YYYY-MM-DD.`},
  {role:'user',content:message}
 ]));
}
const positive=(v:string|null)=>!!v&&/^\d+(\.\d+)?$/.test(v)&&new Decimal(v).gt(0);
function plantCode(value:string,data:MasterData):string|null{
 const words=value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
 const matched=data.plants.filter(p=>words.includes(p.plant.toLowerCase())||p.name.toLowerCase().split(/[^a-z0-9]+/).filter(t=>t.length>2&&t!=='plant').some(t=>words.includes(t)));
 return matched.length===1?matched[0].plant:null;
}
export function deterministicFields(message:string,state:IntakeState,data:MasterData,today:string):Partial<IntakeFields>{
 const f:Partial<IntakeFields>={},text=message.trim();
 const correction=text.match(/^(?:item|description|instead|actually|i mean)\s*[:=]?\s*(.+)$/i);if(correction)f.description=correction[1];
 const quantity=text.match(/\b(?:qty|quantity)\s*[:=]?\s*(\d+(?:\.\d+)?)/i)??text.match(/^(?:i\s+)?(?:need|want|order|get)\s+(\d+(?:\.\d+)?)\b/i);
 if(quantity)f.quantity=quantity[1];
 const numeric=text.match(/^\d+(?:\.\d+)?$/)?.[0];
 if(numeric&&!positive(state.fields.quantity))f.quantity=numeric;
 else if(numeric&&state.force_new&&!positive(state.fields.estimated_unit_price))f.estimated_unit_price=numeric;
 const plant=plantCode(text,data);if(plant)f.plant=plant;
 const iso=text.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0];if(iso)f.need_by_date=iso;
 else if(/\btomorrow\b/i.test(text))f.need_by_date=new Date(Date.parse(today+'T00:00:00Z')+DAY_MS).toISOString().slice(0,10);
 else{const weekday=text.match(/\bnext\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i)?.[1]?.toLowerCase();if(weekday){const target=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'].indexOf(weekday),current=new Date(today+'T00:00:00Z').getUTCDay(),days=(target-current+7)%7||7;f.need_by_date=new Date(Date.parse(today+'T00:00:00Z')+days*DAY_MS).toISOString().slice(0,10);}}
 if(/\bnormal\b|\bnot (?:an? )?emergency\b/i.test(text))f.urgency='Normal';else if(/\bemergency\b/i.test(text))f.urgency='Emergency';
 const price=text.match(/\b(?:price|estimate|rate|each)\s*[:=]?\s*(?:INR|Rs\.?|₹)?\s*(\d+(?:\.\d+)?)/i);if(price)f.estimated_unit_price=price[1];
 const uom=text.match(/\buom\s*[:=]?\s*([a-z]+)/i)?.[1];if(uom)f.uom=uom.toUpperCase();
 else if(state.force_new&&/^(NOS|PAIR|SET|KG|LTR|MTR|JOB|MON|QTR|REAM|ROL|BRL|BKT|CYL)$/i.test(text))f.uom=text.toUpperCase();
 if(!state.fields.description&&!f.description){let desc=text.replace(/^(?:i\s+)?(?:need|want|order|get)\s+(?:\d+(?:\.\d+)?\s*)?/i,'').split(/\s+(?:for|at|by|need[- ]?by|qty|quantity|plant|urgency)\b/i)[0].trim();if(desc&&!numeric&&!/^(normal|emergency)$/i.test(desc))f.description=desc;}
 return f;
}
export function assessIntake(state:IntakeState,data:MasterData,policy:Policy,today:string){
 const f=state.fields;
 const selected=data.items.find(i=>i.item_code===state.selected_item);
 let item:Item|undefined=selected,candidates:{item_code:string;description:string;score?:number}[]=[];
 if(!f.description?.trim())return{question:'What item do you need? Please include a model, size or specification.',ready:false,item:undefined,is_new:false,candidates};
 if(!item&&!state.force_new){const match=matchDescription(f.description,data.items,policy);item=match.item;candidates=match.candidates.slice(0,5);
  if(!item&&!candidates.length){const tokens=normalizeDescription(f.description,policy).map(t=>t.replace(/s$/,''));candidates=data.items.filter(i=>normalizeDescription(i.description,policy).map(t=>t.replace(/s$/,'')).some(t=>t.length>2&&!['the','for','new','per','item','sample'].includes(t)&&tokens.includes(t))).slice(0,5).map(i=>({item_code:i.item_code,description:i.description}));}
  if(!item&&candidates.length)return{question:`Which item do you mean? Give a size/model or choose an existing item code: ${candidates.map(c=>`${c.item_code}: ${c.description}`).join('; ')}. Say NEW if this is genuinely a new item.`,ready:false,item:undefined,is_new:false,candidates};
 }
 const is_new=!item;
 if(!positive(f.quantity))return{question:'What quantity do you need? Enter a positive number (for example, quantity 200).',ready:false,item,is_new,candidates};
 if(!f.plant||!data.plants.some(p=>p.plant===f.plant))return{question:`Which plant needs it? Choose ${data.plants.map(p=>`${p.plant} (${p.name})`).join(' or ')}.`,ready:false,item,is_new,candidates};
 if(!f.need_by_date||!validDate(f.need_by_date)||f.need_by_date<today)return{question:'What is the need-by date? Use YYYY-MM-DD, tomorrow, or next Friday; it cannot be before today.',ready:false,item,is_new,candidates};
 if(!f.urgency)return{question:'Is the request Normal or Emergency? Please choose explicitly.',ready:false,item,is_new,candidates};
 if(is_new&&!positive(f.estimated_unit_price))return{question:'This is a NEW item. What is your estimated unit price in INR? For example, price 1200.',ready:false,item,is_new,candidates};
 if(is_new&&!f.uom)return{question:'What is the unit of measure for this NEW item? For example, UOM NOS, SET, KG or LTR.',ready:false,item,is_new,candidates};
 return{question:`Please confirm: ${f.quantity} ${item?.uom??f.uom} of ${item?`${item.item_code} - ${item.description}`:`NEW - ${f.description}`}, plant ${f.plant}, needed by ${f.need_by_date}, ${f.urgency}${is_new?`, estimated INR ${f.estimated_unit_price} per unit`:''}. Reply CONFIRM to create the PR, or describe a correction.`,ready:true,item,is_new,candidates};
}
export async function intakeTurn(message:string,old:IntakeState,data:MasterData,policy:Policy,today:string,parser?:IntakeParser){
 const state=structuredClone(old);state.stage='collecting';let degraded=false;
 const explicit=data.items.find(i=>message.split(/[\s,;:()]+/).some(t=>t.toLowerCase()===i.item_code.toLowerCase()));
 if(explicit){state.selected_item=explicit.item_code;state.force_new=false;state.fields.description=explicit.description;}
 if(/^new(?: item)?(?:\s*:\s*(.+))?$/i.test(message.trim())){state.selected_item=null;state.force_new=true;const description=message.match(/:\s*(.+)$/)?.[1];if(description)state.fields.description=description;}
 const local=deterministicFields(message,state,data,today);let parsed:Partial<IntakeFields>={};
 if(parser||configured()){try{parsed=intakeSchema.parse(await(parser??parseIntake)(message,state,today));}catch{degraded=true;}}else degraded=true;
 // Parser descriptions must be grounded in actual user words, not invented specifications.
 if(parsed.description){const source=new Set(normalizeDescription(`${message} ${old.fields.description??''}`,policy));if(!normalizeDescription(parsed.description,policy).every(t=>source.has(t)))delete parsed.description;}
 const description=local.description??parsed.description;if(description&&description!==old.fields.description&&!explicit&&!/^new(?: item)?/i.test(message)){state.selected_item=null;state.force_new=false;}
 for(const [key,value]of Object.entries({...parsed,...local}))if(value!==null&&value!==undefined)state.fields[key as keyof IntakeFields]=value as never;
 if(state.fields.plant)state.fields.plant=plantCode(state.fields.plant,data);
 const result=assessIntake(state,data,policy,today);state.stage=result.ready?'confirmation':'collecting';if(result.is_new)state.force_new=true;
 return{state,...result,degraded};
}
