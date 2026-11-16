import type {Request,RequestHandler} from 'express';
import {timingSafeEqual} from 'node:crypto';
export function actor(req:Request):string{
 const value=req.get('x-actor')?.trim();if(!value||value.length>100)throw new Error('Supply x-actor (1-100 characters)');return value;
}
export function adminOnly(token?:string):RequestHandler{return(req,res,next)=>{
 const loopback=['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress??'');
 if(token){const supplied=Buffer.from(req.get('authorization')?.replace(/^Bearer /,'')??''),expected=Buffer.from(token);if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected)){res.status(401).json({error:'Valid admin token required'});return;}}
 else if(!loopback){res.status(403).json({error:'Configure ADMIN_TOKEN for remote changes'});return;}next();
};}
