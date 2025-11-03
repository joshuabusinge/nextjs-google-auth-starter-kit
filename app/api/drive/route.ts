import { NextResponse } from 'next/server';
import { google } from 'googleapis';
import oauth2Client from '../../lib/google-oauth';
import { Readable } from 'stream';
import { cookies } from 'next/headers'; // Import cookies

function convertToWebStream(nodeStream: Readable): ReadableStream<Uint8Array> {
    return new ReadableStream({
        start(controller) {
            nodeStream.on('data', (chunk) => {
                controller.enqueue(chunk);
            });
            nodeStream.on('end', () => {
                controller.close();
            });
            nodeStream.on('error', (err) => {
                controller.error(err);
            });
        },
        cancel() {
            nodeStream.destroy();
        },
    });
}

export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const folderId = searchParams.get('folderId');
    const fileId = searchParams.get('fileId');

    console.log(`[Drive API] Request for folderId: ${folderId}, fileId: ${fileId}`);

    let accessToken: string | undefined;

    // Prioritize checking the 'accessToken' query parameter (from custom image loader)
    const accessTokenFromQuery = searchParams.get('accessToken');
    if (accessTokenFromQuery) {
        accessToken = accessTokenFromQuery;
        console.log('[Drive API] Retrieved access token from query parameter.');
    }

    // Fallback to Authorization header if not found in query
    if (!accessToken) {
        const authorization = req.headers.get('authorization');
        console.log(`[Drive API] Received Authorization header: ${authorization}`);
        if (authorization) {
            accessToken = authorization.split(' ')[1];
            console.log('[Drive API] Retrieved access token from Authorization header.');
        }
    }

    // Fallback to Next.js cookies utility if not found in query or header
    if (!accessToken) {
        const cookieStore = cookies();
        const googleAccessTokenCookie = cookieStore.get('google_access_token');
        console.log(`[Drive API] No access token in query or Authorization header, checking Next.js cookies. google_access_token found: ${!!googleAccessTokenCookie}`);
        if (googleAccessTokenCookie) {
            accessToken = googleAccessTokenCookie.value;
            console.log('[Drive API] Retrieved access token from Next.js cookies.');
        }
    }

    console.log(`[Drive API] Retrieved access token: ${accessToken ? 'Found' : 'Not Found'}`);

    if (!accessToken) {
        console.error('[Drive API] No access token found after checking all sources.');
        return NextResponse.json({ error: 'No access token found' }, { status: 401 });
    }

    console.log('[Drive API] Access token found.');
    oauth2Client.setCredentials({ access_token: accessToken });
    const drive = google.drive({ version: 'v3', auth: oauth2Client });

    if (fileId) {
        // Handle single file download
        try {
            console.log(`[Drive API] Attempting to fetch file: ${fileId}`);
            const response = await drive.files.get({
                fileId: fileId,
                alt: 'media',
            }, { responseType: 'stream' });

            console.log(`[Drive API] Successfully fetched file stream for: ${fileId}`);
            const headers = new Headers();
            headers.set('Content-Type', response.headers['content-type'] as string);
            headers.set('Content-Disposition', response.headers['content-disposition'] as string);

            const webStream = convertToWebStream(response.data as Readable);

            return new NextResponse(webStream, { headers });
        } catch (error: unknown) {
            console.error('[Drive API] Error fetching Google Drive file:', (error as Error).message);
            return NextResponse.json({ error: 'Failed to fetch file from Google Drive', details: (error as Error).message }, { status: 500 });
        }
    } else if (folderId) {
        // Handle folder listing (existing logic)
        try {
            console.log(`[Drive API] Attempting to list files in folder: ${folderId}`);
            const response = await drive.files.list({
                q: `'${folderId}' in parents and mimeType contains 'image/'`,
                fields: 'nextPageToken, files(id, name, mimeType, webContentLink, webViewLink)',
                spaces: 'drive',
            });
            console.log(`[Drive API] Successfully listed ${response.data.files?.length || 0} files in folder: ${folderId}`);
            return NextResponse.json(response.data.files);
        } catch (error: unknown) {
            console.error('[Drive API] Error listing Google Drive files:', (error as Error).message);
            return NextResponse.json({ error: 'Failed to list files from Google Drive', details: (error as Error).message }, { status: 500 });
        }
    } else {
        console.error('[Drive API] Folder ID or File ID is required.');
        return NextResponse.json({ error: 'Folder ID or File ID is required' }, { status: 400 });
    }
}
