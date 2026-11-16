import {resolveOperand,type Condition,type Policy} from '../../engine/src/policy.js';
export interface PolicyChange{subject:string;before:string;after:string}
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
export function describeCondition(c:Condition,p:Policy):string{
 if('all'in c)return c.all.length?c.all.map(x=>`(${describeCondition(x,p)})`).join(' AND '):'always';
 if('any'in c)return c.any.map(x=>`(${describeCondition(x,p)})`).join(' OR ');
 if('not'in c)return`NOT (${describeCondition(c.not,p)})`;
 const op={eq:'equals',ne:'does not equal',in:'is one of',gt:'is greater than',gte:'is at least',lt:'is below',lte:'is at most',between:'is between'}[c.operator];
 return`${c.fact.replaceAll('_',' ')} ${op} ${JSON.stringify(resolveOperand(p,c.value))}`;
}
export function describeDiff(before:Policy,after:Policy):PolicyChange[]{
 const changes:PolicyChange[]=[];
 const add=(subject:string,a:unknown,b:unknown)=>{if(!same(a,b))changes.push({subject,before:a===undefined?'Not defined':typeof a==='string'?a:JSON.stringify(a),after:b===undefined?'Removed':typeof b==='string'?b:JSON.stringify(b)});};
 add('Effective date',before.effective_date,after.effective_date);
 for(const name of new Set([...Object.keys(before.parameters),...Object.keys(after.parameters)]))add(`Parameter: ${name.replaceAll('_',' ')}`,before.parameters[name],after.parameters[name]);
 for(const id of new Set([...before.rules.map(r=>r.id),...after.rules.map(r=>r.id)])){
  const a=before.rules.find(r=>r.id===id),b=after.rules.find(r=>r.id===id);
  if(!same(a,b)){const describe=(r:typeof a,p:Policy)=>r?`Order ${r.order}, clause ${r.clause}: when ${describeCondition(r.when,p)}, use ${r.outcome.route}`:undefined;add(`Rule: ${id}`,describe(a,before),describe(b,after));}
 }
 for(const section of ['fact_registry','route_registry','ranking','matching'] as const){
  const a=before[section] as Record<string,unknown>,b=after[section] as Record<string,unknown>;
  for(const key of new Set([...Object.keys(a),...Object.keys(b)]))add(`${section.replaceAll('_',' ')}: ${key.replaceAll('_',' ')}`,a[key],b[key]);
 }
 return changes;
}
