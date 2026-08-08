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
app.use(express.json());

app.get("/api/ping", (req, res) => {
  res.status(200).send("ping success!");
});


app.post("/api/contact", async (req, res) => {
  const { name, email, subject, phone, message } = req.body;

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
      from: `Gigabull Contact Form <${process.env.SMTP_USER}>`,
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
              <td style="padding: 4px 8px;">${phone}</td>
            </tr>
            <tr>
              <td style="padding: 4px 8px; font-weight: bold;">Subject:</td>
              <td style="padding: 4px 8px;">${subject}</td>
            </tr>
            <tr>
              <td style="padding: 4px 8px; font-weight: bold;">Message:</td>
              <td style="padding: 4px 8px;">${message}</td>
            </tr>
          </table>
        </div>
      `,
    };

    console.log("[EMAIL] Sending to:", process.env.MY_EMAIL);

    const info = await transporter.sendMail(mailOptions);
    console.log("[EMAIL] Message sent:", info.messageId);

    res.status(200).json({ success: true, message: "Email sent successfully." });
  } catch (err) {
    console.error("[ERROR] Failed to send email:", err);
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
