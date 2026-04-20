import { Resend } from "resend";

/**
 * Send verification email with 6-digit code
 * Uses Resend email service with notifications.tagsakay.com domain
 */
export async function sendVerificationEmail(
  resendApiKey: string,
  email: string,
  code: string,
  frontendUrl: string = "https://tagsakay.com"
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    const resend = new Resend(resendApiKey);

    const response = await resend.emails.send({
      from: "noreply@notifications.tagsakay.com",
      to: email,
      subject: "Verify your TagSakay Email",
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <style>
              body { font-family: Arial, sans-serif; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; border-radius: 8px 8px 0 0; text-align: center; }
              .content { background: #f9f9f9; padding: 30px; border: 1px solid #ddd; }
              .code-box { background: white; border: 2px solid #667eea; border-radius: 8px; padding: 20px; text-align: center; margin: 20px 0; }
              .code { font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #667eea; font-family: monospace; }
              .button { display: inline-block; background: #667eea; color: white; padding: 12px 30px; border-radius: 5px; text-decoration: none; margin: 20px 0; }
              .footer { background: #f0f0f0; padding: 15px; text-align: center; font-size: 12px; color: #666; }
              .expires { color: #666; font-size: 14px; margin: 15px 0; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1>🎟️ TagSakay Email Verification</h1>
              </div>
              <div class="content">
                <p>Hello,</p>
                <p>Thank you for registering with TagSakay! To complete your registration, please verify your email address.</p>
                
                <h3>Your verification code is:</h3>
                <div class="code-box">
                  <div class="code">${code}</div>
                </div>
                
                <p>Or click the button below to verify your email:</p>
                <center>
                  <a href="${frontendUrl}/verify-email?code=${code}&email=${encodeURIComponent(
        email
      )}" class="button">
                    Verify Email
                  </a>
                </center>
                
                <div class="expires">
                  ⏱️ This code expires in 24 hours
                </div>
                
                <p style="color: #999; font-size: 12px; margin-top: 30px;">
                  If you didn't create this account, you can safely ignore this email.
                </p>
              </div>
              <div class="footer">
                <p>© 2025 TagSakay. All rights reserved.</p>
              </div>
            </div>
          </body>
        </html>
      `,
    });

    if (response.error) {
      console.error("Email send error:", response.error);
      return {
        success: false,
        error: response.error.message || "Failed to send verification email",
      };
    }

    return {
      success: true,
      messageId: response.data?.id,
    };
  } catch (error: any) {
    console.error("Email service error:", error);
    return {
      success: false,
      error: error.message || "Email service error",
    };
  }
}

/**
 * Send password reset email
 * (For future use)
 */
export async function sendPasswordResetEmail(
  resendApiKey: string,
  email: string,
  resetToken: string,
  frontendUrl: string = "https://tagsakay.com"
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    const resend = new Resend(resendApiKey);

    const response = await resend.emails.send({
      from: "noreply@notifications.tagsakay.com",
      to: email,
      subject: "TagSakay Password Reset",
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <style>
              body { font-family: Arial, sans-serif; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; border-radius: 8px 8px 0 0; text-align: center; }
              .content { background: #f9f9f9; padding: 30px; border: 1px solid #ddd; }
              .button { display: inline-block; background: #667eea; color: white; padding: 12px 30px; border-radius: 5px; text-decoration: none; margin: 20px 0; }
              .footer { background: #f0f0f0; padding: 15px; text-align: center; font-size: 12px; color: #666; }
              .expires { color: #666; font-size: 14px; margin: 15px 0; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1>🔑 Reset Your Password</h1>
              </div>
              <div class="content">
                <p>Hello,</p>
                <p>We received a request to reset your TagSakay password. Click the button below to reset it:</p>
                
                <center>
                  <a href="${frontendUrl}/reset-password?token=${resetToken}" class="button">
                    Reset Password
                  </a>
                </center>
                
                <div class="expires">
                  ⏱️ This link expires in 1 hour
                </div>
                
                <p style="color: #999; font-size: 12px; margin-top: 30px;">
                  If you didn't request a password reset, please ignore this email.
                </p>
              </div>
              <div class="footer">
                <p>© 2025 TagSakay. All rights reserved.</p>
              </div>
            </div>
          </body>
        </html>
      `,
    });

    if (response.error) {
      console.error("Email send error:", response.error);
      return {
        success: false,
        error: response.error.message || "Failed to send reset email",
      };
    }

    return {
      success: true,
      messageId: response.data?.id,
    };
  } catch (error: any) {
    console.error("Email service error:", error);
    return {
      success: false,
      error: error.message || "Email service error",
    };
  }
}
