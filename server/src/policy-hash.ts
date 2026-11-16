import type {Policy} from '../../engine/src/policy.js';
import {sha256} from './import-kit.js';
export function stableJSON(value:unknown):string{
 if(Array.isArray(value))return`[${value.map(stableJSON).join(',')}]`;
 if(value&&typeof value==='object')return`{${Object.entries(value).sort(([a],[b])=>a<b?-1:1).map(([k,v])=>`${JSON.stringify(k)}:${stableJSON(v)}`).join(',')}}`;
 return JSON.stringify(value);
}
export function policyHash(p:Policy):string{const{status,approved_at,approved_by,...behavior}=p;return sha256(stableJSON(behavior));}
