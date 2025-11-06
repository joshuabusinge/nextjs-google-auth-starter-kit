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
/**
 * Recursively fetches all image files from a specified Google Drive folder, handling pagination.
 * @param drive The Google Drive API client.
 * @param folderId The ID of the folder to search within.
 * @param pageToken The page token for the next set of results (for pagination).
 * @param allFiles Accumulator for files found so far.
 * @returns A promise that resolves to an array of DriveFile objects.
 */
async function getAllDriveFilesInFolder(
    drive: any, // Changing to `drive_v3.Drive` does not work because it is not directly exported.
    folderId: string,
    pageToken: string | undefined = undefined,
    allFiles: DriveFile[] = []
): Promise<DriveFile[]> {
    const response = await drive.files.list({
        q: `'${folderId}' in parents and mimeType contains 'image/' and trashed=false`,
        fields: 'nextPageToken, files(id, name, mimeType, webContentLink, webViewLink)',
        spaces: 'drive',
        pageToken: pageToken,
        pageSize: 1000, // Fetch up to 1000 files per request
    });

    const files = response.data.files || [];
    allFiles.push(...files.map((file: DriveFile) => ({
        id: file.id!,
        name: file.name!,
        mimeType: file.mimeType!,
        webContentLink: file.webContentLink || '',
        webViewLink: file.webViewLink || '',
    })));

    if (response.data.nextPageToken) {
        return getAllDriveFilesInFolder(drive, folderId, response.data.nextPageToken, allFiles);
    }

    return allFiles;
}

interface DriveFile {
    id: string;
    name: string;
    mimeType: string;
    webContentLink: string;
    webViewLink: string;
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
    }

    // Fallback to Authorization header if not found in query
    if (!accessToken) {
        const authorization = req.headers.get('authorization');
        if (authorization) {
            accessToken = authorization.split(' ')[1];
        }
    }

    // Fallback to Next.js cookies utility if not found in query or header
    if (!accessToken) {
        const cookieStore = cookies();
        const googleAccessTokenCookie = cookieStore.get('google_access_token');
        if (googleAccessTokenCookie) {
            accessToken = googleAccessTokenCookie.value;
        }
    }

    if (!accessToken) {
        console.error('[Drive API] No access token found after checking all sources.');
        return NextResponse.json({ error: 'No access token found' }, { status: 401 });
    }

    oauth2Client.setCredentials({ access_token: accessToken });
    const drive = google.drive({ version: 'v3', auth: oauth2Client });

    if (fileId) {
        // Handle single file download
        try {
            const response = await drive.files.get({
                fileId: fileId,
                alt: 'media',
            }, { responseType: 'stream' });

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
            const allImageFiles = await getAllDriveFilesInFolder(drive, folderId);
            return NextResponse.json(allImageFiles);
        } catch (error: unknown) {
            console.error('[Drive API] Error listing Google Drive files:', (error as Error).message);
            return NextResponse.json({ error: 'Failed to list files from Google Drive', details: (error as Error).message }, { status: 500 });
        }
    } else {
        console.error('[Drive API] Folder ID or File ID is required.');
        return NextResponse.json({ error: 'Folder ID or File ID is required' }, { status: 400 });
    }
}
