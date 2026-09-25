import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const EXPO_PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send";

interface StatusMeta {
  label: string;
  badgeBg: string;
  badgeText: string;
  headerGradient: string;
  icon: string;
  headline: string;
  message: string;
  step: number; // 1: Placed, 2: Preparing, 3: In Transit, 4: Delivered
}

function getStatusMeta(status: string, sellerName: string): StatusMeta {
  const s = String(status || "").toLowerCase().trim();

  switch (s) {
    case "pending_payment":
      return {
        label: "Payment Pending",
        badgeBg: "#fef3c7",
        badgeText: "#b45309",
        headerGradient: "linear-gradient(135deg, #f59e0b 0%, #d97706 100%)",
        icon: "💳",
        headline: "Awaiting Payment Confirmation",
        message: `Your order is pending payment. Once payment is confirmed, ${sellerName} will begin preparing it.`,
        step: 1,
      };
    case "pending":
      return {
        label: "Order Placed",
        badgeBg: "#e0f2fe",
        badgeText: "#0369a1",
        headerGradient: "linear-gradient(135deg, #0284c7 0%, #0369a1 100%)",
        icon: "📋",
        headline: "Order Received by Store",
        message: `Your order has been received by ${sellerName} and is waiting to be accepted.`,
        step: 1,
      };
    case "processing":
      return {
        label: "Preparing / In Progress",
        badgeBg: "#e0e7ff",
        badgeText: "#3730a3",
        headerGradient: "linear-gradient(135deg, #4f46e5 0%, #3730a3 100%)",
        icon: "🍳",
        headline: "Your Order is Being Prepared!",
        message: `Good news! ${sellerName} has accepted your order and is currently preparing your items.`,
        step: 2,
      };
    case "out_for_delivery":
      return {
        label: "Out for Delivery",
        badgeBg: "#f3e8ff",
        badgeText: "#6b21a8",
        headerGradient: "linear-gradient(135deg, #9333ea 0%, #6b21a8 100%)",
        icon: "🛵",
        headline: "Your Order is on the Way!",
        message: `Your package is on its way with our delivery partner to your delivery address.`,
        step: 3,
      };
    case "shipped":
      return {
        label: "Shipped",
        badgeBg: "#e0e7ff",
        badgeText: "#3730a3",
        headerGradient: "linear-gradient(135deg, #2563eb 0%, #1e40af 100%)",
        icon: "🚚",
        headline: "Your Order has Been Dispatched",
        message: `Your order has been packed and handed over for delivery.`,
        step: 3,
      };
    case "completed":
    case "delivered":
      return {
        label: "Delivered & Completed",
        badgeBg: "#dcfce7",
        badgeText: "#15803d",
        headerGradient: "linear-gradient(135deg, #16a34a 0%, #15803d 100%)",
        icon: "🎉",
        headline: "Order Delivered Successfully!",
        message: `Your order has been delivered. Thank you for shopping with ${sellerName}!`,
        step: 4,
      };
    case "cancelled":
      return {
        label: "Order Cancelled",
        badgeBg: "#fee2e2",
        badgeText: "#991b1b",
        headerGradient: "linear-gradient(135deg, #dc2626 0%, #991b1b 100%)",
        icon: "❌",
        headline: "Your Order has Been Cancelled",
        message: `This order has been cancelled. If any payment was deducted, an automatic refund will be processed.`,
        step: 0,
      };
    default:
      return {
        label: s.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase()),
        badgeBg: "#f1f5f9",
        badgeText: "#334155",
        headerGradient: "linear-gradient(135deg, #0284c7 0%, #0369a1 100%)",
        icon: "📦",
        headline: `Order Status: ${s}`,
        message: `The status of your order has been updated to "${s}".`,
        step: 2,
      };
  }
}

/**
 * Builds responsive buyer status notification email
 */
function buildBuyerOrderStatusEmailHtml(params: {
  buyerName: string;
  orderNumber: string;
  statusMeta: StatusMeta;
  sellerName: string;
  sellerMobile: string;
  orderType: string;
  tableNo?: string;
  shippingAddress?: string;
  totalAmount: number;
  items: Array<{ name: string; variant?: string; quantity: number; price: number; lineTotal: number }>;
  updatedAt: string;
  appUrl: string;
}): string {
  const {
    buyerName,
    orderNumber,
    statusMeta,
    sellerName,
    sellerMobile,
    orderType,
    tableNo,
    shippingAddress,
    totalAmount,
    items,
    updatedAt,
    appUrl,
  } = params;

  const isDineIn = orderType === "Dine-in";
  const trackingUrl = `${appUrl}?order_id=${orderNumber}`;

  // Steps Progress bar (only for active progression, not cancelled)
  let stepsHtml = "";
  if (statusMeta.step > 0) {
    const steps = [
      { num: 1, label: "Placed" },
      { num: 2, label: "Preparing" },
      { num: 3, label: isDineIn ? "Ready" : "On the Way" },
      { num: 4, label: isDineIn ? "Served" : "Delivered" },
    ];

    const stepElements = steps.map((s) => {
      const isReached = statusMeta.step >= s.num;
      const isCurrent = statusMeta.step === s.num;
      const circleBg = isReached ? "#2563eb" : "#e2e8f0";
      const circleColor = isReached ? "#ffffff" : "#94a3b8";
      const labelColor = isCurrent ? "#2563eb" : isReached ? "#1e293b" : "#94a3b8";
      const fontWeight = isCurrent ? "700" : isReached ? "600" : "400";

      return `
        <div style="flex: 1; text-align: center;">
          <div style="width: 28px; height: 28px; border-radius: 50%; background: ${circleBg}; color: ${circleColor}; line-height: 28px; margin: 0 auto 6px auto; font-weight: 700; font-size: 13px;">
            ${isReached && !isCurrent ? "✓" : s.num}
          </div>
          <div style="font-size: 11px; color: ${labelColor}; font-weight: ${fontWeight};">
            ${s.label}
          </div>
        </div>
      `;
    }).join("");

    stepsHtml = `
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 12px; margin: 20px 0;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; max-width: 440px; margin: 0 auto;">
          ${stepElements}
        </div>
      </div>
    `;
  }

  const itemsHtml = items.slice(0, 5).map((i) => `
    <tr style="border-bottom: 1px solid #f1f5f9;">
      <td style="padding: 10px 0; color: #1e293b; font-size: 14px;">
        <span style="font-weight: 600;">${i.name}</span>
        ${i.variant && i.variant !== "Default" ? `<div style="font-size: 12px; color: #64748b;">${i.variant}</div>` : ""}
      </td>
      <td style="padding: 10px 8px; text-align: center; color: #475569; font-size: 13px; font-weight: 600;">
        x${i.quantity}
      </td>
      <td style="padding: 10px 0; text-align: right; color: #0f172a; font-weight: 700; font-size: 14px;">
        ₹${i.lineTotal.toFixed(2)}
      </td>
    </tr>
  `).join("");

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Order #${orderNumber} Update</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 20px 0; color: #1e293b;">
  <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05); border: 1px solid #e2e8f0;">
    
    <!-- Top Header -->
    <div style="background: ${statusMeta.headerGradient}; padding: 26px 20px; text-align: center; color: #ffffff;">
      <div style="font-size: 36px; margin-bottom: 8px;">${statusMeta.icon}</div>
      <h1 style="margin: 0; font-size: 22px; font-weight: 800; letter-spacing: -0.5px;">${statusMeta.headline}</h1>
      <p style="margin: 6px 0 0 0; font-size: 14px; opacity: 0.95;">Order #${orderNumber} • ${sellerName}</p>
    </div>

    <!-- Status Banner -->
    <div style="padding: 24px 20px;">
      <div style="text-align: center; margin-bottom: 16px;">
        <span style="display: inline-block; background-color: ${statusMeta.badgeBg}; color: ${statusMeta.badgeText}; font-size: 13px; font-weight: 700; padding: 6px 14px; border-radius: 9999px;">
          Status: ${statusMeta.label}
        </span>
      </div>

      <p style="font-size: 15px; line-height: 1.5; color: #334155; text-align: center; margin: 0 0 20px 0;">
        Hello <strong>${buyerName || "Customer"}</strong>,<br>
        ${statusMeta.message}
      </p>

      ${stepsHtml}

      <!-- Order Details Summary -->
      <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
        <div style="font-weight: 700; font-size: 14px; color: #0f172a; margin-bottom: 12px; border-bottom: 1px solid #f1f5f9; padding-bottom: 8px;">
          Order Summary (${isDineIn ? `Table: ${tableNo || "Counter"}` : "Parcel Delivery"})
        </div>

        <table style="width: 100%; border-collapse: collapse;">
          ${itemsHtml}
          <tr>
            <td colspan="2" style="padding-top: 12px; font-weight: 700; color: #0f172a; font-size: 15px;">
              Total Order Amount:
            </td>
            <td style="padding-top: 12px; text-align: right; font-weight: 800; color: #2563eb; font-size: 16px;">
              ₹${totalAmount.toFixed(2)}
            </td>
          </tr>
        </table>

        ${shippingAddress ? `
          <div style="margin-top: 14px; padding-top: 12px; border-top: 1px solid #f1f5f9; font-size: 12px; color: #64748b;">
            <strong>Delivery Address:</strong> ${shippingAddress}
          </div>
        ` : ""}
      </div>

      <!-- Action Button -->
      <div style="text-align: center; margin: 24px 0 16px 0;">
        <a href="${trackingUrl}" style="display: inline-block; background-color: #2563eb; color: #ffffff; text-decoration: none; font-weight: 700; font-size: 15px; padding: 13px 28px; border-radius: 8px; box-shadow: 0 2px 4px rgba(37, 99, 235, 0.2);">
          📍 Track Live Order Online
        </a>
      </div>

      <!-- Support / Contact -->
      <div style="text-align: center; font-size: 12px; color: #64748b; margin-top: 20px;">
        Store: <strong>${sellerName}</strong> ${sellerMobile ? `• Phone: <a href="tel:${sellerMobile}" style="color: #2563eb; text-decoration: none;">${sellerMobile}</a>` : ""}<br>
        Updated on: ${updatedAt}
      </div>

    </div>

    <!-- Footer -->
    <div style="background-color: #f1f5f9; padding: 14px 20px; text-align: center; font-size: 12px; color: #64748b; border-top: 1px solid #e2e8f0;">
      You received this update because you provided your contact email during checkout.
    </div>

  </div>
</body>
</html>
  `;
}

serve(async (req) => {
  // CORS Preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json().catch(() => ({}));
    const record = body.record || null;
    const oldRecord = body.old_record || null;

    const targetOrderId = body.orderId || record?.id;
    const newStatus = body.newStatus || record?.status || "updated";
    const oldStatus = oldRecord?.status || null;

    if (!targetOrderId) {
      return new Response(JSON.stringify({ error: "Missing orderId in request body" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    // 1. Fetch full order with items and variant combinations
    const { data: order, error: orderErr } = await supabase
      .from("orders")
      .select(`
        *,
        order_items (
          quantity,
          price,
          product_variant_combinations (
            combination_string,
            price,
            mrp,
            products (
              product_name,
              mrp,
              user_id
            )
          )
        )
      `)
      .eq("id", targetOrderId)
      .maybeSingle();

    if (orderErr || !order) {
      throw new Error(`Failed to load order ${targetOrderId}: ${orderErr?.message}`);
    }

    const orderNumber = order.order_number || String(order.id).substring(0, 8).toUpperCase();
    const userId = order.user_id;

    // 2. Identify Seller
    const sellerId = order.seller_id || order.order_items?.[0]?.product_variant_combinations?.products?.user_id;
    let sellerName = "Store";
    let sellerMobile = "";

    if (sellerId) {
      const { data: sellerProf } = await supabase
        .from("profiles")
        .select("full_name, store_name, mobile")
        .eq("id", sellerId)
        .maybeSingle();
      sellerName = sellerProf?.store_name || sellerProf?.full_name || "Store";
      sellerMobile = sellerProf?.mobile || "";
    }

    // 3. Resolve Buyer Email (Optional for Buyer)
    const shippingObj = typeof order.shipping_address === "object" ? order.shipping_address : null;
    let buyerEmail = (order.customer_email || shippingObj?.email || "").trim() || null;
    let buyerName = (order.customer_name || shippingObj?.name || "").trim() || "Customer";

    if (!buyerEmail && userId) {
      const { data: buyerProfile } = await supabase
        .from("profiles")
        .select("email, full_name")
        .eq("id", userId)
        .maybeSingle();
      buyerEmail = buyerProfile?.email?.trim() || null;
      if (buyerProfile?.full_name && buyerName === "Customer") {
        buyerName = buyerProfile.full_name;
      }
    }

    const appUrl = Deno.env.get("PUBLIC_APP_URL") || "https://narasimhareddyaiapp2-localwala.github.io/needsTracking/";
    const dispatchResults: { email?: unknown; expo?: unknown; web?: unknown[] } = {};

    // 4. Send Email via Resend if buyer provided an email address
    if (buyerEmail && buyerEmail.includes("@")) {
      const statusMeta = getStatusMeta(newStatus, sellerName);

      const parsedItems = (order.order_items || []).map((oi: any) => {
        const combo = oi.product_variant_combinations;
        const prod = combo?.products;
        const itemName = prod?.product_name || "Product";
        const variant = combo?.combination_string || "";
        const quantity = Number(oi.quantity || 1);
        const price = Number(oi.price || combo?.price || 0);
        return {
          name: itemName,
          variant,
          quantity,
          price,
          lineTotal: price * quantity,
        };
      });

      const shippingAddress = typeof order.shipping_address === "string"
        ? order.shipping_address
        : shippingObj?.address || "";

      const emailHtml = buildBuyerOrderStatusEmailHtml({
        buyerName,
        orderNumber,
        statusMeta,
        sellerName,
        sellerMobile,
        orderType: order.order_type || "shop-order",
        tableNo: order.table_no,
        shippingAddress,
        totalAmount: Number(order.total_amount || 0),
        items: parsedItems,
        updatedAt: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
        appUrl,
      });

      const resendApiKey = Deno.env.get("RESEND_API_KEY");
      if (resendApiKey) {
        try {
          const resendRes = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${resendApiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              from: Deno.env.get("EMAIL_FROM") || "Orders <orders@resend.dev>",
              to: [buyerEmail],
              subject: `📦 [Order #${orderNumber}] ${statusMeta.label}`,
              html: emailHtml,
            }),
          });
          dispatchResults.email = await resendRes.json();
          console.log(`[notify-order-update] Status update email sent to buyer: ${buyerEmail}`);
        } catch (resendErr: any) {
          console.error("[notify-order-update] Resend email error:", resendErr);
          dispatchResults.email = { error: resendErr?.message };
        }
      } else {
        console.log(`[notify-order-update] RESEND_API_KEY not configured. Status email ready for ${buyerEmail}.`);
        dispatchResults.email = { notice: "Set RESEND_API_KEY in Supabase secrets to dispatch automatically." };
      }
    } else {
      console.log(`[notify-order-update] No buyer email provided (optional for buyer) - skipping email dispatch.`);
      dispatchResults.email = { skipped: true, reason: "No buyer email provided (buyer optional)" };
    }

    // 5. Send Native Expo & Web Push Notifications (if user_id registered)
    if (userId) {
      const { data: tokens, error: tokensError } = await supabase
        .from("push_tokens")
        .select("token")
        .eq("user_id", userId);

      if (!tokensError && tokens) {
        const rawTokens = tokens.map((t: { token: string }) => t.token).filter(Boolean);

        const expoTokens = rawTokens.filter((t: string) =>
          t.startsWith("ExponentPushToken") || t.startsWith("ExpoPushToken")
        );
        const webTokens = rawTokens.filter((t: string) =>
          t.startsWith("web:") || t.startsWith("{")
        );

        const title = `📦 Order Update #${orderNumber}`;
        const body = `Status changed to: ${newStatus.replace(/_/g, " ")}`;
        const payloadData = { orderId: targetOrderId, orderNumber, status: newStatus, type: "order_status_update" };

        if (expoTokens.length > 0) {
          try {
            const expoRes = await fetch(EXPO_PUSH_ENDPOINT, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                to: expoTokens,
                title,
                body,
                sound: "default",
                data: payloadData,
              }),
            });
            dispatchResults.expo = await expoRes.json();
          } catch (expoErr) {
            console.warn("[notify-order-update] Expo push notice:", expoErr);
          }
        }

        if (webTokens.length > 0) {
          const webResults = [];
          for (const token of webTokens) {
            try {
              let subscriptionStr = token;
              if (subscriptionStr.startsWith("web:")) subscriptionStr = subscriptionStr.slice(4);
              if (subscriptionStr.startsWith("{")) {
                const subscription = JSON.parse(subscriptionStr);
                if (subscription.endpoint) {
                  const webRes = await fetch(subscription.endpoint, {
                    method: "POST",
                    headers: { "Content-Type": "application/json", "TTL": "86400" },
                    body: JSON.stringify({
                      title,
                      body,
                      icon: "./icon-192.png",
                      badge: "./icon-192.png",
                      data: payloadData,
                    }),
                  }).catch((e) => ({ status: 500, error: String(e) }));
                  webResults.push({ endpoint: subscription.endpoint, status: (webRes as any).status });
                }
              }
            } catch (e) {
              console.warn("[notify-order-update] Web push notice:", e);
            }
          }
          dispatchResults.web = webResults;
        }
      }
    } else {
      console.log(`[notify-order-update] Guest order (no user_id) - push notifications skipped.`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        orderId: targetOrderId,
        orderNumber,
        newStatus,
        buyerEmail,
        results: dispatchResults,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error: any) {
    console.error("Error in notify-order-update function:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
