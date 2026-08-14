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

// Server-side PDF Documents Metadata Store (Google Drive Links & Metadata)
let serverDocumentsData = null;

async function getStoredDocumentsData() {
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (redisUrl && redisToken) {
    try {
      const response = await fetch(`${redisUrl}/get/documents_data`, {
        headers: { Authorization: `Bearer ${redisToken}` }
      });
      const data = await response.json();
      if (data && data.result) {
        return typeof data.result === 'string' ? JSON.parse(data.result) : data.result;
      }
    } catch (err) {
      console.error("[DOCUMENTS] Failed to fetch documents from Upstash Redis:", err);
    }
  }
  return serverDocumentsData;
}

async function saveStoredDocumentsData(documentsData) {
  serverDocumentsData = documentsData;
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
        body: JSON.stringify(["SET", "documents_data", JSON.stringify(documentsData)])
      });
      console.log("[DOCUMENTS] Documents metadata persisted to Upstash Redis");
    } catch (err) {
      console.error("[DOCUMENTS] Failed to persist documents data to Upstash Redis:", err);
    }
  }
}

// Document Metadata Endpoints (Google Drive Link Sync)
app.get("/api/documents", async (req, res) => {
  try {
    const docs = await getStoredDocumentsData();
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    return res.status(200).json({ success: true, documents: docs || {} });
  } catch (err) {
    console.error("[DOCUMENTS] Error fetching documents:", err);
    return res.status(500).json({ success: false, error: "Failed to fetch documents" });
  }
});

app.post("/api/save-documents", async (req, res) => {
  const { documents } = req.body;
  if (!documents) {
    return res.status(400).json({ success: false, error: "documents is required" });
  }

  try {
    await saveStoredDocumentsData(documents);
    console.log("[DOCUMENTS] Documents metadata updated on server");
    return res.status(200).json({ success: true, message: "Documents saved successfully" });
  } catch (err) {
    console.error("[DOCUMENTS] Error saving documents metadata:", err);
    return res.status(500).json({ success: false, error: "Failed to save documents metadata" });
  }
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
      subject: subject || "Product Enquiry - GIGABULL",
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
          <h2 style="color: #DFBF58;">New Product Enquiry</h2>
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
