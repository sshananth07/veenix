import { ensureBucket } from "../src/storage/storage";

ensureBucket().then(() => console.log("bucket ready"), (e) => { console.error(e); process.exit(1); });
