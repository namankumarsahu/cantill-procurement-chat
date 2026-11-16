import {z} from 'zod';
import {validatePolicy,type Policy} from '../../engine/src/policy.js';
export const editSchema=z.strictObject({operations:z.array(z.strictObject({op:z.enum(['add','replace','remove']),path:z.string().regex(/^\//),value_json:z.string().nullable()})).max(128),unresolved:z.array(z.string())});
export type PolicyEdits=z.infer<typeof editSchema>;
export const editsJSONSchema=z.toJSONSchema(editSchema);
export function applyPolicyEdits(base:Policy,input:unknown):Policy{
 const edits=editSchema.parse(input);if(edits.unresolved.length)throw new Error(`Policy needs clarification: ${edits.unresolved.join('; ')}`);
 if(!edits.operations.length)throw new Error('No policy changes were extracted');
 const result=structuredClone(base) as unknown as Record<string,unknown>;
 for(const edit of edits.operations){
  if(/~(?![01])/.test(edit.path))throw new Error('Invalid JSON pointer escape');
  const keys=edit.path.slice(1).split('/').map(k=>k.replaceAll('~1','/').replaceAll('~0','~'));
  if(!['parameters','rules','fact_registry','route_registry','ranking','matching'].includes(keys[0])||keys.some(k=>['__proto__','prototype','constructor'].includes(k)))throw new Error(`Unsupported policy edit path: ${edit.path}`);
  let parent:unknown=result;
  for(const key of keys.slice(0,-1)){if(!parent||typeof parent!=='object'||!Object.hasOwn(parent,key))throw new Error(`Unknown edit path ${edit.path}`);parent=(parent as Record<string,unknown>)[key];}
  if(!parent||typeof parent!=='object')throw new Error('Edit parent must be an object/array');
  const key=keys.at(-1)!,value=edit.op==='remove'?undefined:JSON.parse(edit.value_json??'null');
  if(Array.isArray(parent)){
   const i=key==='-'?parent.length:Number(key);
   if(!/^(0|[1-9]\d*|-)$/.test(key)||!Number.isInteger(i)||i>parent.length||(edit.op!=='add'&&i>=parent.length))throw new Error('Invalid array edit index');
   if(edit.op==='add')parent.splice(i,0,value);else if(edit.op==='remove')parent.splice(i,1);else parent[i]=value;
  }else{const object=parent as Record<string,unknown>;if(edit.op!=='add'&&!Object.hasOwn(object,key))throw new Error(`Missing edit target ${edit.path}`);if(edit.op==='remove')delete object[key];else object[key]=value;}
 }
 return validatePolicy(result);
}
