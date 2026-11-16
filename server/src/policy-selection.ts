import type pg from 'pg';
import { validatePolicy,type Policy } from '../../engine/src/policy.js';
export async function selectPolicy(client:pg.Pool|pg.PoolClient,date:string,version?:string):Promise<Policy>{
  const result=version
    ? await client.query("SELECT document FROM policy_versions WHERE version=$1 AND status <> 'draft' AND approved_at IS NOT NULL AND effective_date <= $2",[version,date])
    : await client.query("SELECT document FROM policy_versions WHERE status <> 'draft' AND approved_at IS NOT NULL AND effective_date <= $1 ORDER BY effective_date DESC,approved_at DESC,version DESC LIMIT 1",[date]);
  if(!result.rowCount) throw new Error('No approved policy effective on the requested as-of date');
  return validatePolicy(result.rows[0].document);
}
