import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const EXPO_PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send";

/**
 * Builds responsive HTML email template for Low Stock & Out of Stock Alerts
 */
function buildStockAlertEmailHtml(params: {
  storeName: string;
  productName: string;
  variantString: string;
  sku?: string;
  currentStock: number;
  threshold: number;
  isOutOfStock: boolean;
  price?: number;
  inventoryUrl: string;
  timestamp: string;
}): string {
  const {
    storeName,
    productName,
    variantString,
    sku,
    currentStock,
    threshold,
    isOutOfStock,
    price,
    inventoryUrl,
    timestamp,
  } = params;

  const headerBg = isOutOfStock
    ? "linear-gradient(135deg, #ef4444 0%, #dc2626 100%)"
    : "linear-gradient(135deg, #f59e0b 0%, #d97706 100%)";
  const headerIcon = isOutOfStock ? "🛑" : "⚠️";
  const headerTitle = isOutOfStock ? "Out of Stock Alert" : "Low Stock Alert";
  const badgeBg = isOutOfStock ? "#fee2e2" : "#fef3c7";
  const badgeColor = isOutOfStock ? "#b91c1c" : "#b45309";
  const statusLabel = isOutOfStock
    ? "OUT OF STOCK"
    : `LOW STOCK (${currentStock} left)`;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${headerTitle} - ${productName}</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px 0; color: #1e293b;">
  <div style="max-width: 560px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05); border: 1px solid #e2e8f0;">
    
    <!-- Top Header -->
    <div style="background: ${headerBg}; padding: 24px 20px; text-align: center; color: #ffffff;">
      <div style="font-size: 32px; margin-bottom: 6px;">${headerIcon}</div>
      <h1 style="margin: 0 0 4px 0; font-size: 22px; font-weight: 800; letter-spacing: -0.5px;">${headerTitle}</h1>
      <p style="margin: 0; font-size: 14px; opacity: 0.95;">Store: <strong>${storeName}</strong></p>
    </div>

    <!-- Alert Description Banner -->
    <div style="background-color: ${badgeBg}; border-bottom: 1px solid #e2e8f0; padding: 12px 20px; text-align: center;">
      <span style="display: inline-block; font-size: 13px; font-weight: 700; color: ${badgeColor}; text-transform: uppercase; letter-spacing: 0.5px;">
        ${statusLabel}
      </span>
      <div style="font-size: 13px; color: #475569; margin-top: 2px;">
        ${
          isOutOfStock
            ? "This product has reached 0 units and can no longer be ordered by customers."
            : `Stock has fallen to ${currentStock} unit(s), which is at or below the safety threshold of ${threshold}.`
        }
      </div>
    </div>

    <div style="padding: 24px;">
      <!-- Product Details Card -->
      <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 18px; margin-bottom: 20px;">
        <div style="font-size: 12px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px;">
          Product Details
        </div>
        <div style="font-size: 17px; font-weight: 800; color: #0f172a; margin-bottom: 4px;">
          ${productName}
        </div>
        ${
          variantString && variantString !== "Default"
            ? `<div style="font-size: 13px; color: #475569; margin-bottom: 4px;"><strong>Variant:</strong> ${variantString}</div>`
            : ""
        }
        ${
          sku
            ? `<div style="font-size: 13px; color: #64748b; margin-bottom: 4px;"><strong>SKU:</strong> ${sku}</div>`
            : ""
        }
        ${
          price !== undefined && price !== null
            ? `<div style="font-size: 13px; color: #64748b; margin-bottom: 4px;"><strong>Selling Price:</strong> ₹${Number(price).toFixed(2)}</div>`
            : ""
        }
        <div style="margin-top: 12px; padding-top: 10px; border-top: 1px dashed #cbd5e1; display: flex; justify-content: space-between; align-items: center;">
          <span style="font-size: 14px; font-weight: 600; color: #334155;">Current Available Quantity:</span>
          <span style="font-size: 18px; font-weight: 800; color: ${isOutOfStock ? "#dc2626" : "#d97706"};">
            ${currentStock} unit(s)
          </span>
        </div>
      </div>

      <!-- Action Button -->
      <div style="text-align: center; margin: 28px 0 16px 0;">
        <a href="${inventoryUrl}" style="background-color: #007AFF; color: #ffffff; font-weight: 700; font-size: 15px; padding: 14px 28px; border-radius: 8px; text-decoration: none; display: inline-block; box-shadow: 0 2px 4px rgba(0,122,255,0.3);">
          📦 Open Inventory & Restock Now
        </a>
      </div>

      <!-- Footer Info -->
      <div style="font-size: 12px; color: #94a3b8; text-align: center; margin-top: 20px; line-height: 1.5;">
        Alert triggered on ${timestamp}.<br/>
        This automated notification was sent to the store owner and inventory managers.
      </div>
    </div>
  </div>
</body>
</html>
  `;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(
        JSON.stringify({ error: "Missing Supabase configuration." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const body = await req.json().catch(() => ({}));

    // Support direct invocation and webhook payloads
    const record = body.record || body;
    const variantId = body.product_variant_combination_id || body.variant_id || record?.id;
    const inputNewQuantity = body.new_quantity !== undefined ? Number(body.new_quantity) : (record?.quantity !== undefined ? Number(record.quantity) : null);
    const inputThreshold = Number(body.threshold || 5);
    const forceAlert = Boolean(body.force);

    if (!variantId && !body.product_id) {
      return new Response(
        JSON.stringify({ error: "Missing product_variant_combination_id or variant_id." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 1. Fetch variant and associated product details
    let variant: any = null;
    let product: any = null;

    if (variantId) {
      const { data: vData, error: vErr } = await supabase
        .from("product_variant_combinations")
        .select(`
          id,
          product_id,
          combination_string,
          quantity,
          price,
          mrp,
          sku,
          products (
            id,
            product_name,
            user_id,
            amount,
            mrp,
            unit
          )
        `)
        .eq("id", variantId)
        .single();

      if (vErr || !vData) {
        throw new Error(`Variant ${variantId} not found: ${vErr?.message}`);
      }
      variant = vData;
      product = vData.products;
    } else if (body.product_id) {
      const { data: pData, error: pErr } = await supabase
        .from("products")
        .select("id, product_name, user_id, amount, mrp, unit")
        .eq("id", body.product_id)
        .single();

      if (pErr || !pData) {
        throw new Error(`Product ${body.product_id} not found: ${pErr?.message}`);
      }
      product = pData;
    }

    const currentStock = inputNewQuantity !== null ? inputNewQuantity : Number(variant?.quantity ?? 0);
    const sellerId = body.seller_id || product?.user_id;

    if (!sellerId) {
      return new Response(
        JSON.stringify({ error: "Could not identify seller for this product." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Evaluate Stock Threshold
    const isOutOfStock = currentStock <= 0;
    const isLowStock = currentStock > 0 && currentStock <= inputThreshold;

    if (!isOutOfStock && !isLowStock && !forceAlert) {
      return new Response(
        JSON.stringify({
          success: true,
          message: `Stock level (${currentStock}) is above threshold (${inputThreshold}). No alert needed.`,
          currentStock,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. Fetch Seller Profile (Store Name, Email)
    const { data: sellerProfile } = await supabase
      .from("profiles")
      .select("id, full_name, email, mobile")
      .eq("id", sellerId)
      .maybeSingle();

    const storeName = sellerProfile?.full_name || "Store";
    const sellerEmail = sellerProfile?.email?.trim() || null;

    // 4. Fetch Staff with Inventory Management Permissions
    const { data: employees } = await supabase
      .from("seller_employees")
      .select("id, name, email, mobile, permissions, is_active, user_id")
      .eq("seller_id", sellerId)
      .eq("is_active", true);

    const inventoryStaff = (employees || []).filter((emp: any) => {
      const perms = emp.permissions || {};
      // Alert staff who have can_manage_inventory: true
      return perms.can_manage_inventory === true;
    });

    // 5. Gather Target Emails (Seller + Authorized Staff)
    const recipientEmailsSet = new Set<string>();
    if (sellerEmail && sellerEmail.includes("@")) {
      recipientEmailsSet.add(sellerEmail.toLowerCase());
    }

    inventoryStaff.forEach((emp: any) => {
      if (emp.email && emp.email.includes("@")) {
        recipientEmailsSet.add(emp.email.trim().toLowerCase());
      }
    });

    const recipientEmails = Array.from(recipientEmailsSet);

    // 6. Gather Push Tokens for Seller and Staff
    const targetUserIds = [sellerId];
    inventoryStaff.forEach((emp: any) => {
      if (emp.user_id) targetUserIds.push(emp.user_id);
    });

    const { data: tokenRecords } = await supabase
      .from("push_tokens")
      .select("token")
      .in("user_id", targetUserIds);

    const pushTokens = Array.from(
      new Set(
        (tokenRecords || [])
          .map((r: any) => r.token)
          .filter((t: any) => t && typeof t === "string")
      )
    );

    const appUrl = Deno.env.get("PUBLIC_APP_URL") || "https://narasimhareddyaiapp2-localwala.github.io/needsTracking/";
    const inventoryUrl = `${appUrl}#/inventory`;
    const productName = product?.product_name || "Product";
    const variantString = variant?.combination_string || "";
    const sku = variant?.sku || undefined;
    const price = variant?.price || product?.amount || undefined;
    const timestamp = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });

    const results: { email?: any; push?: any } = {};

    // 7. Send Email via SMTP (if configured) or Resend (as fallback)
    if (recipientEmails.length > 0) {
      const smtpHost = Deno.env.get("SMTP_HOST");
      const smtpUser = Deno.env.get("SMTP_USER");
      const smtpPass = Deno.env.get("SMTP_PASS");
      const resendApiKey = Deno.env.get("RESEND_API_KEY");
      const fromAddress = Deno.env.get("EMAIL_FROM") || (smtpUser ? `Inventory Alerts <${smtpUser}>` : "Inventory Alerts <alerts@resend.dev>");

      const emailSubject = isOutOfStock
        ? `🛑 [OUT OF STOCK] ${productName}${variantString && variantString !== "Default" ? ` (${variantString})` : ""} is at 0 units!`
        : `⚠️ [LOW STOCK ALERT] ${productName}${variantString && variantString !== "Default" ? ` (${variantString})` : ""} - only ${currentStock} unit(s) left!`;

      const emailHtml = buildStockAlertEmailHtml({
        storeName,
        productName,
        variantString,
        sku,
        currentStock,
        threshold: inputThreshold,
        isOutOfStock,
        price,
        inventoryUrl,
        timestamp,
      });

      if (smtpHost && smtpUser && smtpPass) {
        // Send via Custom SMTP directly
        try {
          const port = Number(Deno.env.get("SMTP_PORT") || 465);
          const client = new SMTPClient({
            connection: {
              hostname: smtpHost,
              port,
              tls: port === 465,
              auth: {
                username: smtpUser,
                password: smtpPass,
              },
            },
          });

          await client.send({
            from: fromAddress,
            to: recipientEmails,
            subject: emailSubject,
            html: emailHtml,
          });
          await client.close();

          results.email = { sent: true, method: "smtp", recipients: recipientEmails };
          console.log(`[send-stock-alert] Email alert sent via SMTP (${smtpHost}) to ${recipientEmails.join(", ")}`);
        } catch (smtpErr: any) {
          console.error("[send-stock-alert] SMTP error:", smtpErr);
          results.email = { sent: false, method: "smtp", error: smtpErr?.message };
        }
      } else if (resendApiKey) {
        // Send via Resend API
        try {
          const resendRes = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${resendApiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              from: fromAddress,
              to: recipientEmails,
              subject: emailSubject,
              html: emailHtml,
            }),
          });
          const resendData = await resendRes.json();
          results.email = { sent: true, method: "resend", recipients: recipientEmails, response: resendData };
          console.log(`[send-stock-alert] Email alert sent via Resend to ${recipientEmails.join(", ")}`);
        } catch (emailErr: any) {
          console.error("[send-stock-alert] Resend error:", emailErr);
          results.email = { sent: false, method: "resend", error: emailErr?.message };
        }
      } else {
        console.log(`[send-stock-alert] Neither SMTP nor RESEND_API_KEY configured. Intended recipients: ${recipientEmails.join(", ")}`);
        results.email = {
          sent: false,
          notice: "No email provider configured. Provide SMTP credentials (SMTP_HOST, SMTP_USER, SMTP_PASS) or RESEND_API_KEY in Supabase secrets.",
          recipients: recipientEmails,
        };
      }
    }

    // 8. Send Push Notifications via Expo Push
    if (pushTokens.length > 0) {
      const pushTitle = isOutOfStock
        ? `🛑 Out of Stock: ${productName}`
        : `⚠️ Low Stock Alert: ${productName}`;
      const pushBody = isOutOfStock
        ? `${productName}${variantString && variantString !== "Default" ? ` (${variantString})` : ""} is completely out of stock! Tap to restock.`
        : `Only ${currentStock} unit(s) remaining for ${productName}! Tap to restock.`;

      try {
        const pushRes = await fetch(EXPO_PUSH_ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            "Accept-Encoding": "gzip, deflate",
          },
          body: JSON.stringify({
            to: pushTokens,
            title: pushTitle,
            body: pushBody,
            sound: "default",
            data: {
              type: "stock_alert",
              product_id: product?.id,
              variant_id: variant?.id,
              current_stock: currentStock,
              is_out_of_stock: isOutOfStock,
            },
          }),
        });
        const pushData = await pushRes.json();
        results.push = { sent: true, tokenCount: pushTokens.length, response: pushData };
        console.log(`[send-stock-alert] Push notification sent to ${pushTokens.length} tokens.`);
      } catch (pushErr: any) {
        console.error("[send-stock-alert] Push error:", pushErr);
        results.push = { sent: false, error: pushErr?.message };
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        alertType: isOutOfStock ? "out_of_stock" : "low_stock",
        productName,
        currentStock,
        recipients: {
          emails: recipientEmails,
          pushTokenCount: pushTokens.length,
          staffNotifiedCount: inventoryStaff.length,
        },
        results,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("[send-stock-alert] Unhandled error:", err);
    return new Response(
      JSON.stringify({ error: err?.message || "An unexpected error occurred." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
