import { app } from "./index.js";

const PORT = Number(process.env.PORT ?? 3000);

app.listen(PORT, () => {
    console.log(`🚀 Hyros AI gateway running at http://${app.server?.hostname}:${app.server?.port}`);
});