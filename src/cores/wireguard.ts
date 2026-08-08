import { HttpStatus, respond, safeError } from '@common';
import { getSettings, getWarpAccounts } from '@settings';
import { zipStore, type ZipEntry } from '@cores/zip';

export async function getWireguardConfigs(isPro: boolean): Promise<Response> {
    try {
        const warpAccounts = getWarpAccounts();
        if (warpAccounts.length < 1) {
            throw new Error('WARP accounts are unavailable. Renew WARP accounts in Settings before generating WARP configurations.');
        }
        const { warpIPv6, publicKey, privateKey } = warpAccounts[0];
        const {
            warpEndpoints,
            warpRemoteDNS,
            amneziaNoiseCount,
            amneziaNoiseSizeMin,
            amneziaNoiseSizeMax
        } = getSettings();

        const entries: ZipEntry[] = [];

        warpEndpoints?.forEach((endpoint, index) => {
            const conf = [
                '[Interface]',
                `PrivateKey = ${privateKey}`,
                `Address = 172.16.0.2/32, ${warpIPv6}`,
                `DNS = ${warpRemoteDNS}`,
                'MTU = 1280',
                ...(isPro ? [
                    `Jc = ${amneziaNoiseCount}`,
                    `Jmin = ${amneziaNoiseSizeMin}`,
                    `Jmax = ${amneziaNoiseSizeMax}`,
                    'S1 = 0',
                    'S2 = 0',
                    'H1 = 1',
                    'H2 = 2',
                    'H3 = 3',
                    'H4 = 4'
                ] : []),
                '',
                '[Peer]',
                `PublicKey = ${publicKey}`,
                'AllowedIPs = 0.0.0.0/0, ::/0',
                `Endpoint = ${endpoint}`,
                'PersistentKeepalive = 25'
            ].join('\n');

            entries.push({ name: `${_project_}-Warp-${index + 1}.conf`, content: conf });
        });

        const archive = zipStore(entries);

        const fileName = isPro ? 'pro-amnezia' : 'wireguard';
        // `zipStore` allocates its buffer at the exact archive size, so the backing
        // ArrayBuffer is the archive with nothing after it and needs no copy. The
        // cast is only because the Workers `BodyInit` union names ArrayBuffer rather
        // than ArrayBufferLike.
        return new Response(archive.buffer as ArrayBuffer, {
            headers: {
                'Content-Type': 'application/zip',
                'Content-Disposition': `attachment; filename=${_project_SM_}-warp-${fileName}-conf.zip`,
                'Cache-Control': 'no-store, no-cache, must-revalidate',
                'Pragma': 'no-cache'
            },
        });
    } catch (error) {
        return respond(false, HttpStatus.INTERNAL_SERVER_ERROR, `Error generating ZIP file: ${safeError(error)}`);
    }
}