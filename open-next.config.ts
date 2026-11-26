// OpenNext adapter config for Cloudflare Workers. See CLOUDFLARE.md.
// No incremental cache yet: almost every page is dynamic (per hotel, per
// guest), and static pages are served from the Worker's assets.
import { defineCloudflareConfig } from '@opennextjs/cloudflare';

export default defineCloudflareConfig({});
