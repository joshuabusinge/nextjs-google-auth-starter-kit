import { NextResponse } from 'next/server';
import { google } from 'googleapis';
import oauth2Client from '../../lib/google-oauth';
// import { cookies } from 'next/headers'; // No longer reading cookies directly
import { Readable } from 'stream';
import { drive_v3 } from 'googleapis';

const CSV_FILE_NAME = 'image_labels.csv';
const CSV_HEADERS = 'timestamp,userEmail,imageId,imageName,Mid-sagittal_section,Neutral_position,Horizontal_orientation,Crown_and_rump_clearly_visible,Correct_caliper_placement,Magnification,comments\n';

export async function POST(req: Request) {
    console.log("Incoming /api/labels request headers:", req.headers);
    try {
        const { imageId, imageName, scores, comments, folderId } = await req.json();

        if (!imageId || !imageName || !scores || !comments || !folderId) {
            return NextResponse.json({ error: 'Missing required labeling data' }, { status: 400 });
        }

        const authorization = req.headers.get('authorization');
        const accessToken = authorization?.split(' ')[1];
        const idToken = req.headers.get('x-google-id-token');

        if (!accessToken || !idToken) {
            return NextResponse.json({ error: 'Authentication tokens not found in headers' }, { status: 401 });
        }

        oauth2Client.setCredentials({ access_token: accessToken });
        const drive = google.drive({ version: 'v3', auth: oauth2Client });

        let userEmail = 'unknown@example.com';
        try {
            const ticket = await oauth2Client.verifyIdToken({
                idToken,
                audience: process.env.CLIENT_ID,
            });
            const payload = ticket.getPayload();
            if (payload?.email) {
                userEmail = payload.email;
            }
        } catch (idTokenError) {
            console.error('Error verifying ID token:', idTokenError);
            // Continue with default email if verification fails
        }

        const timestamp = new Date().toISOString();
        const scoreString = scores.join(',');
        const newRow = `${timestamp},${userEmail},${imageId},${imageName},${scoreString},"${comments.replace(/"/g, '""')}"\n`;

        // 1. Search for the CSV file in the specified folder
        let csvFileId: string | undefined;
        let existingContent = '';

        try {
            const searchResponse = await drive.files.list({
                q: `'${folderId}' in parents and name='${CSV_FILE_NAME}' and trashed=false`,
                fields: 'files(id, name)',
                spaces: 'drive',
            });
            if (searchResponse.data.files && searchResponse.data.files.length > 0) {
                csvFileId = searchResponse.data.files[0].id!;
            }
        } catch (searchError: unknown) {
            console.error('Error searching for CSV file:', (searchError as Error).message);
            // Proceed, as the file might not exist, which is handled next
        }

        if (csvFileId) {
            // 2. If CSV exists, download its content
            try {
                const response = await drive.files.get({ fileId: csvFileId, alt: 'media' }, { responseType: 'stream' });
                const chunks: Buffer[] = [];
                await new Promise<void>((resolve, reject) => {
                    const nodeStream = response.data as Readable;
                    nodeStream.on('data', (chunk: Buffer) => chunks.push(chunk));
                    nodeStream.on('end', () => resolve());
                    nodeStream.on('error', reject);
                });
                existingContent = Buffer.concat(chunks).toString('utf8');
            } catch (downloadError: unknown) {
                console.error('Error downloading existing CSV file:', (downloadError as Error).message);
                // If download fails, treat as if file doesn't exist and create new
                csvFileId = undefined;
            }
        }

        let fileContent = existingContent;
        if (!csvFileId || !existingContent.includes(CSV_HEADERS.trim())) {
            // If file doesn't exist or headers are missing, add headers
            fileContent = CSV_HEADERS;
        }
        fileContent += newRow;

        const media = {
            mimeType: 'text/csv',
            body: fileContent,
        };

        if (csvFileId) {
            // 3. Update existing CSV file
            const updateParams: drive_v3.Params$Resource$Files$Update = {
                fileId: csvFileId,
                addParents: folderId,
                media,
            };
            await drive.files.update(updateParams);
        } else {
            // 4. Create new CSV file
            await drive.files.create({
                requestBody: {
                    name: CSV_FILE_NAME,
                    parents: [folderId],
                    mimeType: 'text/csv',
                },
                media,
            });
        }

        return NextResponse.json({ message: 'Labeling data saved successfully!' });

    } catch (error: unknown) {
        console.error('Error saving labeling data:', (error as Error).message);
        return NextResponse.json({ error: 'Failed to save labeling data', details: (error as Error).message }, { status: 500 });
    }
}
