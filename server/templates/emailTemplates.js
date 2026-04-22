/**
 * Email HTML templates for EMBR3-WQMS
 * All templates share a consistent brand: EMB palette + logo text header.
 */

const BASE_URL = process.env.CLIENT_URL || 'http://localhost:5173';

const header = `
  <div style="background:linear-gradient(135deg,#101F43 0%,#253C78 60%,#395BAF 100%);
              padding:28px 32px 22px;border-radius:10px 10px 0 0;text-align:center;">
    <h1 style="margin:0;color:#ffffff;font-size:20px;font-family:sans-serif;
               letter-spacing:0.04em;font-weight:700;">
      Environmental Management Bureau
    </h1>
    <p style="margin:6px 0 0;color:#DDF8DA;font-size:12px;font-family:sans-serif;
              letter-spacing:0.1em;text-transform:uppercase;">
      Water Quality Monitoring System &mdash; Region III
    </p>
  </div>
`;

const footer = `
  <div style="background:#EEF0FB;padding:16px 32px;border-radius:0 0 10px 10px;
              text-align:center;border-top:1px solid #D6DBF6;">
    <p style="margin:0;color:#395BAF;font-size:12px;font-family:sans-serif;">
      &copy; ${new Date().getFullYear()} Environmental Management Bureau &mdash; EMBR3 WQMS.<br/>
      This is an automated message. Please do not reply to this email.
    </p>
  </div>
`;

const wrap = (content) => `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:32px 16px;background:#f1f5f9;font-family:sans-serif;">
  <div style="max-width:520px;margin:0 auto;
              border-radius:10px;box-shadow:0 4px 24px rgba(16,31,67,0.13);overflow:hidden;">
    ${header}
    <div style="background:#ffffff;padding:32px;">
      ${content}
    </div>
    ${footer}
  </div>
</body>
</html>
`;

/* ── Welcome Email (sent after successful registration) ── */
const welcomeTemplate = ({ name }) => ({
  subject: 'Welcome to EMBR3-WQMS — Account Created',
  html: wrap(`
    <h2 style="color:#101F43;font-size:18px;margin:0 0 8px;">Welcome, ${name}!</h2>
    <p style="color:#253C78;font-size:14px;line-height:1.6;margin:0 0 16px;">
      Your account has been successfully created on the
      <strong>EMB Water Quality Monitoring System</strong>.
      You can now log in and access real-time water quality data for Region III.
    </p>
    <div style="text-align:center;margin:24px 0;">
      <a href="${BASE_URL}/login"
         style="background:linear-gradient(135deg,#253C78,#446ACB);color:#fff;
                text-decoration:none;padding:12px 32px;border-radius:6px;
                font-size:15px;font-weight:600;display:inline-block;">
        Go to Login
      </a>
    </div>
    <p style="color:#496E44;font-size:13px;margin:0;">
      If you did not create this account, please contact your system administrator immediately.
    </p>
  `),
});

/* ── Forgot Password Email ── */
const forgotPasswordTemplate = ({ name, resetToken }) => ({
  subject: 'EMBR3-WQMS — Password Reset Request',
  html: wrap(`
    <h2 style="color:#101F43;font-size:18px;margin:0 0 8px;">Password Reset Request</h2>
    <p style="color:#253C78;font-size:14px;line-height:1.6;margin:0 0 8px;">
      Hi <strong>${name}</strong>, we received a request to reset the password for your
      EMBR3-WQMS account.
    </p>
    <p style="color:#253C78;font-size:14px;line-height:1.6;margin:0 0 20px;">
      Click the button below to reset your password. This link is valid for
      <strong>1 hour</strong>.
    </p>
    <div style="text-align:center;margin:24px 0;">
      <a href="${BASE_URL}/reset-password/${resetToken}"
         style="background:linear-gradient(135deg,#253C78,#446ACB);color:#fff;
                text-decoration:none;padding:12px 32px;border-radius:6px;
                font-size:15px;font-weight:600;display:inline-block;">
        Reset My Password
      </a>
    </div>
    <p style="color:#64748b;font-size:12px;margin:16px 0 0;word-break:break-all;">
      Or copy this link into your browser:<br/>
      <span style="color:#446ACB;">${BASE_URL}/reset-password/${resetToken}</span>
    </p>
    <hr style="border:none;border-top:1px solid #D6DBF6;margin:20px 0;"/>
    <p style="color:#ef4444;font-size:13px;margin:0;">
      If you did not request a password reset, ignore this email — your password will remain unchanged.
    </p>
  `),
});

/* ── Password Reset Success Email ── */
const passwordResetSuccessTemplate = ({ name }) => ({
  subject: 'EMBR3-WQMS — Password Successfully Reset',
  html: wrap(`
    <h2 style="color:#101F43;font-size:18px;margin:0 0 8px;">Password Reset Successful</h2>
    <p style="color:#253C78;font-size:14px;line-height:1.6;margin:0 0 16px;">
      Hi <strong>${name}</strong>, your EMBR3-WQMS account password has been successfully reset.
    </p>
    <div style="background:#DDF8DA;border-left:4px solid #6FA469;
                border-radius:4px;padding:12px 16px;margin:0 0 20px;">
      <p style="margin:0;color:#355232;font-size:13px;">
        ✅ Your password was changed on <strong>${new Date().toLocaleString('en-PH', { timeZone: 'Asia/Manila' })}</strong> (PHT).
      </p>
    </div>
    <div style="text-align:center;margin:24px 0;">
      <a href="${BASE_URL}/login"
         style="background:linear-gradient(135deg,#253C78,#446ACB);color:#fff;
                text-decoration:none;padding:12px 32px;border-radius:6px;
                font-size:15px;font-weight:600;display:inline-block;">
        Sign In
      </a>
    </div>
    <p style="color:#ef4444;font-size:13px;margin:0;">
      If you did not perform this action, contact your system administrator immediately.
    </p>
  `),
});

module.exports = { welcomeTemplate, forgotPasswordTemplate, passwordResetSuccessTemplate };
