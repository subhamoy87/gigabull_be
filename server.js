import express from "express";
import nodemailer from "nodemailer";
import cors from "cors";
import dotenv from "dotenv";
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

const ALLOWED_ORIGINS = (process.env.CLIENT_URL || "").split(",").map((o) => o.trim().replace(/\/$/, "").toLowerCase());

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    const normalized = origin.replace(/\/$/, "").toLowerCase();
    if (ALLOWED_ORIGINS.includes(normalized)) {
      console.log("[CORS] Origin allowed:", origin);
      return callback(null, true);
    }
    if (/^https?:\/\/(www\.)?gigabull\.in$/.test(normalized)) {
      return callback(null, true);
    }
    return callback(new Error(`Not allowed by CORS: ${origin}`), false);
  },
  methods: ["HEAD", "GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
};

app.use(cors(corsOptions));
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// In-memory products store (persisted to Redis if configured)
let serverProductsData = null;

async function getStoredProductsData() {
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (redisUrl && redisToken) {
    try {
      const response = await fetch(`${redisUrl}/get/products_data`, {
        headers: { Authorization: `Bearer ${redisToken}` }
      });
      const data = await response.json();
      if (data && data.result) {
        return JSON.parse(data.result);
      }
    } catch (err) {
      console.error("[PRODUCTS] Failed to fetch products from Upstash Redis:", err);
    }
  }
  return serverProductsData;
}

async function saveStoredProductsData(productsData) {
  serverProductsData = productsData;
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (redisUrl && redisToken) {
    try {
      await fetch(redisUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${redisToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(["SET", "products_data", JSON.stringify(productsData)])
      });
      console.log("[PRODUCTS] Products data persisted to Upstash Redis");
    } catch (err) {
      console.error("[PRODUCTS] Failed to persist products data to Upstash Redis:", err);
    }
  }
}

// Products Endpoints
app.get("/api/products", async (req, res) => {
  try {
    const products = await getStoredProductsData();
    return res.status(200).json({ success: true, productsData: products });
  } catch (err) {
    console.error("[PRODUCTS] Error fetching products:", err);
    return res.status(500).json({ success: false, error: "Failed to fetch products" });
  }
});

app.post("/api/save-products-data", async (req, res) => {
  const { productsData } = req.body;
  if (!productsData) {
    return res.status(400).json({ success: false, error: "productsData is required" });
  }

  try {
    await saveStoredProductsData(productsData);
    console.log("[PRODUCTS] Products updated on server");
    return res.status(200).json({ success: true, message: "Products saved successfully on server" });
  } catch (err) {
    console.error("[PRODUCTS] Error saving products:", err);
    return res.status(500).json({ success: false, error: "Failed to save products" });
  }
});

// Server-side PDF Document Store (Certificate & Brochure)
let certificateBuffer = null;
let certificateFileName = "RCMC Certificate.pdf";

let brochureBuffer = null;
let brochureFileName = "Brochure Gigabull.pdf";

async function loadDocumentsFromRedis() {
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!redisUrl || !redisToken) return;

  try {
    const certRes = await fetch(`${redisUrl}/get/certificate_data`, {
      headers: { Authorization: `Bearer ${redisToken}` }
    });
    const certData = await certRes.json();
    if (certData && certData.result) {
      const parsed = typeof certData.result === 'string' ? JSON.parse(certData.result) : certData.result;
      if (parsed.pdfBase64) {
        const clean = parsed.pdfBase64.replace(/^data:application\/pdf;base64,/, "").trim();
        certificateBuffer = Buffer.from(clean, "base64");
      }
      if (parsed.fileName) certificateFileName = parsed.fileName;
    }

    const brochRes = await fetch(`${redisUrl}/get/brochure_data`, {
      headers: { Authorization: `Bearer ${redisToken}` }
    });
    const brochData = await brochRes.json();
    if (brochData && brochData.result) {
      const parsed = typeof brochData.result === 'string' ? JSON.parse(brochData.result) : brochData.result;
      if (parsed.pdfBase64) {
        const clean = parsed.pdfBase64.replace(/^data:application\/pdf;base64,/, "").trim();
        brochureBuffer = Buffer.from(clean, "base64");
      }
      if (parsed.fileName) brochureFileName = parsed.fileName;
    }
  } catch (err) {
    console.error("[DOCUMENTS] Error loading documents from Redis:", err);
  }
}
loadDocumentsFromRedis();

async function saveDocumentToRedis(key, data) {
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!redisUrl || !redisToken) {
    console.warn(`[DOCUMENTS] Upstash Redis credentials missing. Cannot save ${key}.`);
    return;
  }

  try {
    const jsonStr = JSON.stringify(data);
    const res = await fetch(redisUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${redisToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(["SET", key, jsonStr])
    });
    const result = await res.json();
    console.log(`[DOCUMENTS] Upstash Redis SET result for ${key}:`, result);
  } catch (err) {
    console.error(`[DOCUMENTS] Failed to save ${key} to Upstash Redis:`, err);
  }
}

// Endpoints to upload certificate PDF
app.post("/api/upload-certificate", async (req, res) => {
  const { pdfBase64, fileName } = req.body;
  if (!pdfBase64) {
    return res.status(400).json({ success: false, error: "pdfBase64 is required" });
  }

  try {
    const cleanBase64 = pdfBase64.replace(/^data:application\/pdf;base64,/, "").trim();
    certificateBuffer = Buffer.from(cleanBase64, "base64");
    if (fileName) certificateFileName = fileName;

    await saveDocumentToRedis("certificate_data", { pdfBase64, fileName: certificateFileName });

    console.log("[DOCUMENTS] Certificate PDF updated on server:", certificateFileName);
    return res.status(200).json({
      success: true,
      message: "Certificate uploaded successfully",
      fileName: certificateFileName
    });
  } catch (err) {
    console.error("[DOCUMENTS] Error saving certificate:", err);
    return res.status(500).json({ success: false, error: "Failed to save certificate" });
  }
});

// Endpoints to upload brochure PDF
app.post("/api/upload-brochure", async (req, res) => {
  const { pdfBase64, fileName } = req.body;
  if (!pdfBase64) {
    return res.status(400).json({ success: false, error: "pdfBase64 is required" });
  }

  try {
    const cleanBase64 = pdfBase64.replace(/^data:application\/pdf;base64,/, "").trim();
    brochureBuffer = Buffer.from(cleanBase64, "base64");
    if (fileName) brochureFileName = fileName;

    await saveDocumentToRedis("brochure_data", { pdfBase64, fileName: brochureFileName });

    console.log("[DOCUMENTS] Brochure PDF updated on server:", brochureFileName);
    return res.status(200).json({
      success: true,
      message: "Brochure uploaded successfully",
      fileName: brochureFileName
    });
  } catch (err) {
    console.error("[DOCUMENTS] Error saving brochure:", err);
    return res.status(500).json({ success: false, error: "Failed to save brochure" });
  }
});

// Serve Certificate PDF binary directly
app.get("/api/documents/certificate", async (req, res) => {
  if (!certificateBuffer) {
    await loadDocumentsFromRedis();
  }
  if (!certificateBuffer) {
    return res.status(404).send("No custom certificate uploaded yet.");
  }
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${certificateFileName}"`);
  res.send(certificateBuffer);
});

// Serve Brochure PDF binary directly
app.get("/api/documents/brochure", async (req, res) => {
  if (!brochureBuffer) {
    await loadDocumentsFromRedis();
  }
  if (!brochureBuffer) {
    return res.status(404).send("No custom brochure uploaded yet.");
  }
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${brochureFileName}"`);
  res.send(brochureBuffer);
});

// Get document metadata and server status
app.get("/api/documents", async (req, res) => {
  if (!certificateBuffer || !brochureBuffer) {
    await loadDocumentsFromRedis();
  }
  return res.status(200).json({
    success: true,
    documents: {
      certificateUrl: certificateBuffer ? "/api/documents/certificate" : null,
      certificateName: certificateFileName,
      brochureUrl: brochureBuffer ? "/api/documents/brochure" : null,
      brochureName: brochureFileName,
    }
  });
});

// Endpoint to get document metadata (filenames and status)
app.get("/api/documents/info", (req, res) => {
  return res.status(200).json({
    success: true,
    hasCertificate: !!certificateBuffer,
    certificateFileName,
    hasBrochure: !!brochureBuffer,
    brochureFileName,
  });
});

// Server-side admin password logic driven strictly by process.env.ADMIN_PASSWORD

async function updateVercelEnvVar(key, value) {
  const token = process.env.VERCEL_TOKEN;
  const projectId = process.env.VERCEL_PROJECT_ID;
  const teamId = process.env.VERCEL_TEAM_ID;

  if (!token || !projectId) {
    return false;
  }

  const teamQuery = teamId ? `?teamId=${teamId}` : "";

  try {
    const listRes = await fetch(`https://api.vercel.com/v9/projects/${projectId}/env${teamQuery}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const listData = await listRes.json();
    const existing = listData.envs ? listData.envs.find((e) => e.key === key) : null;

    if (existing) {
      const patchRes = await fetch(`https://api.vercel.com/v9/projects/${projectId}/env/${existing.id}${teamQuery}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ value }),
      });
      return patchRes.ok;
    } else {
      const postRes = await fetch(`https://api.vercel.com/v10/projects/${projectId}/env${teamQuery}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          key,
          value,
          type: "plain",
          target: ["production", "preview", "development"],
        }),
      });
      return postRes.ok;
    }
  } catch (err) {
    console.error("[VERCEL ENV] Failed to update env var:", err);
    return false;
  }
}

async function setAdminPassword(newPassword) {
  process.env.ADMIN_PASSWORD = newPassword;

  const updatedOnVercel = await updateVercelEnvVar("ADMIN_PASSWORD", newPassword);
  if (updatedOnVercel) {
    console.log("[AUTH] Admin password updated in Vercel Environment Variables via API");
    return { success: true, message: "Password updated permanently in Vercel Environment Variables!" };
  }

  console.warn("[AUTH] Admin password updated in process env. Update ADMIN_PASSWORD in Vercel Dashboard Settings to persist across redeployments.");
  return {
    success: true,
    message: "Password updated for active session. Remember to set ADMIN_PASSWORD in Vercel Project Settings for permanent persistence.",
  };
}

app.get("/api/ping", (req, res) => {
  res.status(200).send("ping success!");
});

// Admin Login Endpoint
app.post("/api/admin/login", async (req, res) => {
  const { password } = req.body;
  if (!password) {
    return res.status(400).json({ success: false, error: "Password is required" });
  }

  const currentPassword = process.env.ADMIN_PASSWORD;

  if (!currentPassword) {
    console.error("[AUTH] ADMIN_PASSWORD environment variable is not configured on server.");
    return res.status(500).json({ success: false, error: "Server authentication misconfigured. ADMIN_PASSWORD env variable missing." });
  }

  if (password === currentPassword) {
    console.log("[AUTH] Admin login successful");
    return res.status(200).json({ success: true, message: "Admin authenticated successfully" });
  }

  console.warn("[AUTH] Admin login failed: invalid password");
  return res.status(401).json({ success: false, error: "Invalid admin password" });
});

// Admin Change Password Endpoint
app.post("/api/admin/change-password", async (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword || typeof newPassword !== "string" || !newPassword.trim()) {
    return res.status(400).json({ success: false, error: "New password is required" });
  }

  const result = await setAdminPassword(newPassword.trim());
  return res.status(200).json(result);
});


app.post("/api/contact", async (req, res) => {
  const { name, email, subject, phone, message } = req.body;

  if (!name || !email || !message) {
    return res.status(400).json({ error: "Missing required fields." });
  }

  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    const mailOptions = {
      from: `Gigabull Enquiry <${process.env.SMTP_USER}>`,
      to: process.env.MY_EMAIL,
      subject: subject || "New Contact Form Submission - GIGABULL",
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
          <h2 style="color: #DFBF58;">New Contact Submission</h2>
          <p>You have received a new message through the contact form:</p>
          <table style="margin-top: 10px;">
            <tr>
              <td style="padding: 4px 8px; font-weight: bold;">Name:</td>
              <td style="padding: 4px 8px;">${name}</td>
            </tr>
            <tr>
              <td style="padding: 4px 8px; font-weight: bold;">Email:</td>
              <td style="padding: 4px 8px;">${email}</td>
            </tr>
            <tr>
              <td style="padding: 4px 8px; font-weight: bold;">Phone:</td>
              <td style="padding: 4px 8px;">${phone || "N/A"}</td>
            </tr>
            <tr>
              <td style="padding: 4px 8px; font-weight: bold;">Subject:</td>
              <td style="padding: 4px 8px;">${subject || "N/A"}</td>
            </tr>
            <tr>
              <td style="padding: 4px 8px; font-weight: bold;">Message:</td>
              <td style="padding: 4px 8px;">${message}</td>
            </tr>
          </table>
        </div>
      `,
    };

    console.log(`[EMAIL] Sending contact form to ${process.env.MY_EMAIL}`);
    const info = await transporter.sendMail(mailOptions);
    console.log("[EMAIL] Contact form sent:", info.messageId);

    res.status(200).json({ success: true, message: "Email sent successfully." });
  } catch (err) {
    console.error("[ERROR] Failed to send contact email:", err);
    res.status(500).json({ error: "Failed to send email." });
  }
});

app.post("/api/enquiries", async (req, res) => {
  const { name, email, message, productName, productSlug } = req.body;

  if (!name || !email || !message || !productName || !productSlug) {
    return res.status(400).json({ error: "Missing required fields." });
  }

  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    const productLink = `https://gigabull.in/product/${productSlug}`;

    const mailOptions = {
      from: `Gigabull Enquiry <${process.env.SMTP_USER}>`,
      to: process.env.MY_EMAIL,
      subject: `Product Enquiry - ${productName}`,
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
          <h2 style="color: #DFBF58;">New Product Enquiry</h2>
          <p>You have received a new enquiry for the product: <strong>${productName}</strong></p>

          <p>
            <strong>Product Link:</strong>
            <a href="${productLink}" target="_blank" rel="noopener noreferrer">${productLink}</a>
          </p>

          <table style="margin-top: 10px;">
            <tr>
              <td style="padding: 4px 8px; font-weight: bold;">Name:</td>
              <td style="padding: 4px 8px;">${name}</td>
            </tr>
            <tr>
              <td style="padding: 4px 8px; font-weight: bold;">Email:</td>
              <td style="padding: 4px 8px;">${email}</td>
            </tr>
            <tr>
              <td style="padding: 4px 8px; font-weight: bold;">Message:</td>
              <td style="padding: 4px 8px;">${message}</td>
            </tr>
          </table>
        </div>
      `,
    };

    console.log(`[EMAIL] Sending enquiry for: ${productName} to ${process.env.MY_EMAIL}`);
    const info = await transporter.sendMail(mailOptions);
    console.log("[EMAIL] Enquiry sent:", info.messageId);

    res.status(200).json({ success: true, message: "Enquiry sent successfully." });
  } catch (err) {
    console.error("[ERROR] Failed to send enquiry email:", err);
    res.status(500).json({ error: "Failed to send enquiry email." });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Contact server listening on port ${PORT}`);
});

export default app;
