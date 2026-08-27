import { NextResponse } from 'next/server';
import { generateRegistrationOptions } from '@simplewebauthn/server';
import { getSession } from '../../../../../lib/auth.js';
import { rpConfig,setChallenge,credentialsFor } from '../../../../../lib/passkey.js';
export async function POST(){const s=await getSession();if(!s)return NextResponse.json({error:'Oturum gerekli.'},{status:401});const {rpID,rpName}=await rpConfig();const creds=await credentialsFor(s.user);const options=await generateRegistrationOptions({rpName,rpID,userName:s.user,userDisplayName:s.user,userID:new TextEncoder().encode(s.user),attestationType:'none',excludeCredentials:creds.map(c=>({id:c.id,transports:c.transports||[]})),authenticatorSelection:{residentKey:'preferred',userVerification:'required'}});await setChallenge(options.challenge,s.user,'register');return NextResponse.json(options)}
