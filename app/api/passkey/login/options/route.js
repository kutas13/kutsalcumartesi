import { NextResponse } from 'next/server';
import { generateAuthenticationOptions } from '@simplewebauthn/server';
import { userConfig } from '../../../../../lib/auth.js';
import { rpConfig,setChallenge,credentialsFor } from '../../../../../lib/passkey.js';
export async function POST(req){const {user}=await req.json();if(!userConfig[user])return NextResponse.json({error:'Kullanıcı bulunamadı.'},{status:404});const creds=await credentialsFor(user);if(!creds.length)return NextResponse.json({error:'Bu kullanıcı için Face ID / Passkey kayıtlı değil.'},{status:404});const {rpID}=await rpConfig();const options=await generateAuthenticationOptions({rpID,allowCredentials:creds.map(c=>({id:c.id,transports:c.transports||[]})),userVerification:'required'});await setChallenge(options.challenge,user,'login');return NextResponse.json(options)}
