import { NextResponse } from 'next/server';
import  oauth2Client  from '../../../lib/google-oauth';
import { cookies } from 'next/headers';

export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const code = searchParams.get('code');
    const error = searchParams.get('error');

    console.log('[OAuth2 Callback] Host:', req.headers.get('host'));
    console.log('[OAuth2 Callback] X-Forwarded-Proto:', req.headers.get('x-forwarded-proto'));

    if (error) {
        return NextResponse.json({ error: 'Google OAuth Error: ' + error });
      }
    
    if (!code) {
        return NextResponse.json({ error: 'Authorization code not found' });
    }

    //let's exchange the code for an access token
    try {
        const { tokens } = await oauth2Client.getToken(code);
        console.log("Tokens received:", tokens);

        const dashboardUrl = new URL('/dashboard', req.url);
        if (tokens.access_token) {
            dashboardUrl.searchParams.set('access_token', tokens.access_token);
        }
        if (tokens.id_token) {
            dashboardUrl.searchParams.set('id_token', tokens.id_token);
        }

        return NextResponse.redirect(dashboardUrl);

    } catch (error) {
        return NextResponse.json({ error: 'Failed to exchange code for access token' + error });
    }

}