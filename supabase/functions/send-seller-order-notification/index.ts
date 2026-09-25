import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}


const EXPO_PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send";

interface ItemOfferInfo {
  name: string;
  variant: string;
  quantity: number;
  price: number;
  mrp: number | null;
  hasOffer: boolean;
  discountPercentage: number;
  unitSavings: number;
  totalSavings: number;
  lineTotal: number;
}

/**
 * Builds a responsive HTML email template for sellers with dynamic offer styling
 */
function buildSellerOrderEmailHtml(params: {
  sellerName: string;
  orderNumber: string;
  orderType: string;
  customerName: string;
  customerMobile: string;
  tableNo?: string;
  shippingAddress?: string;
  paymentMethod: string;
  paymentReference?: string;
  items: ItemOfferInfo[];
  subtotal: number;
  totalOfferSavings: number;
  cgst: number;
  sgst: number;
  serviceCost: number;
  deliveryFee: number;
  isFreeDelivery: boolean;
  totalAmount: number;
  createdAt: string;
  appUrl: string;
}): string {
  const {
    sellerName,
    orderNumber,
    orderType,
    customerName,
    customerMobile,
    tableNo,
    shippingAddress,
    paymentMethod,
    paymentReference,
    items,
    subtotal,
    totalOfferSavings,
    cgst,
    sgst,
    serviceCost,
    deliveryFee,
    isFreeDelivery,
    totalAmount,
    createdAt,
    appUrl,
  } = params;

  const hasAnyOffers = totalOfferSavings > 0;
  const isParcel = orderType === "Parcel" || orderType === "Delivery";

  const itemsRowsHtml = items
    .map((item) => {
      const priceDisplay = item.hasOffer && item.mrp
        ? `<div>
             <span style="text-decoration: line-through; color: #94a3b8; font-size: 12px; margin-right: 4px;">₹${item.mrp.toFixed(2)}</span>
             <strong style="color: #0f172a; font-size: 14px;">₹${item.price.toFixed(2)}</strong>
             <span style="background-color: #dcfce7; color: #15803d; font-size: 10px; font-weight: bold; padding: 2px 6px; border-radius: 4px; margin-left: 4px; display: inline-block;">
               ${item.discountPercentage}% OFF
             </span>
             <div style="color: #16a34a; font-size: 11px; margin-top: 2px;">Saved ₹${item.totalSavings.toFixed(2)}</div>
           </div>`
        : `<strong style="color: #0f172a; font-size: 14px;">₹${item.price.toFixed(2)}</strong>`;

      return `
        <tr style="border-bottom: 1px solid #f1f5f9;">
          <td style="padding: 12px 8px; vertical-align: top;">
            <div style="font-weight: 600; color: #1e293b; font-size: 14px;">${item.name}</div>
            ${item.variant && item.variant !== "Default" ? `<div style="color: #64748b; font-size: 12px; margin-top: 2px;">Variant: ${item.variant}</div>` : ""}
          </td>
          <td style="padding: 12px 8px; text-align: center; color: #334155; font-size: 14px; font-weight: 600; vertical-align: top;">
            x${item.quantity}
          </td>
          <td style="padding: 12px 8px; text-align: right; vertical-align: top;">
            ${priceDisplay}
          </td>
          <td style="padding: 12px 8px; text-align: right; font-weight: 700; color: #0f172a; font-size: 14px; vertical-align: top;">
            ₹${item.lineTotal.toFixed(2)}
          </td>
        </tr>
      `;
    })
    .join("");

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>New Order #${orderNumber}</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 20px 0; color: #1e293b;">
  <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -2px rgba(0, 0, 0, 0.05); border: 1px solid #e2e8f0;">
    
    <!-- Top Header -->
    <div style="background: linear-gradient(135deg, #0ea5e9 0%, #2563eb 100%); padding: 28px 24px; text-align: center; color: #ffffff;">
      <h1 style="margin: 0 0 6px 0; font-size: 22px; font-weight: 800; letter-spacing: -0.5px;">🎉 New Order Received!</h1>
      <p style="margin: 0; font-size: 14px; opacity: 0.95;">Hello <strong>${sellerName}</strong>, a customer just placed an order with your store.</p>
    </div>

    <!-- Offer Spotlight Banner (Rendered if any items have active offers) -->
    ${
      hasAnyOffers
        ? `
    <div style="background-color: #f0fdf4; border-bottom: 2px solid #86efac; border-top: 1px solid #bbf7d0; padding: 12px 20px; display: flex; align-items: center;">
      <div style="font-size: 18px; margin-right: 10px;">🏷️</div>
      <div>
        <div style="font-weight: 700; color: #15803d; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px;">Product Offer Applied!</div>
        <div style="color: #166534; font-size: 13px;">Customer saved <strong style="color: #047857;">₹${totalOfferSavings.toFixed(2)}</strong> via active promotional discounts on this order.</div>
      </div>
    </div>`
        : ""
    }

    <!-- Order Summary Cards -->
    <div style="padding: 24px;">
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
        <tr>
          <td style="padding: 6px 0; color: #64748b; font-size: 13px;">Order Number:</td>
          <td style="padding: 6px 0; text-align: right; font-weight: 700; color: #0f172a; font-size: 14px;">#${orderNumber}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #64748b; font-size: 13px;">Date & Time:</td>
          <td style="padding: 6px 0; text-align: right; color: #334155; font-size: 13px;">${createdAt}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #64748b; font-size: 13px;">Order Type:</td>
          <td style="padding: 6px 0; text-align: right;">
            <span style="background-color: ${isParcel ? "#fef3c7" : "#e0e7ff"}; color: ${isParcel ? "#b45309" : "#4338ca"}; font-size: 12px; font-weight: 700; padding: 3px 8px; border-radius: 6px;">
              ${isParcel ? "📦 PARCEL / DELIVERY" : "🍽️ DINE-IN (" + (tableNo || "Counter") + ")"}
            </span>
          </td>
        </tr>
        <tr>
          <td style="padding: 6px 0; color: #64748b; font-size: 13px;">Payment Method:</td>
          <td style="padding: 6px 0; text-align: right; font-weight: 600; color: #0f172a; font-size: 13px;">
            ${paymentMethod.toUpperCase()}${paymentReference ? ` • Pay Code: <span style="font-family: monospace; background: #e0e7ff; padding: 2px 6px; border-radius: 4px; color: #4338ca;">${paymentReference}</span>` : ""}
          </td>
        </tr>
      </table>

      <!-- Customer Details Box -->
      <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px 16px; margin-bottom: 24px;">
        <div style="font-weight: 700; font-size: 12px; text-transform: uppercase; color: #64748b; letter-spacing: 0.5px; margin-bottom: 8px;">Customer Details</div>
        <div style="font-size: 14px; font-weight: 600; color: #0f172a;">${customerName || "Customer"}</div>
        ${customerMobile ? `<div style="font-size: 13px; color: #475569; margin-top: 2px;">📞 ${customerMobile}</div>` : ""}
        ${shippingAddress ? `<div style="font-size: 13px; color: #475569; margin-top: 4px;">📍 ${shippingAddress}</div>` : ""}
      </div>

      <!-- Items Table -->
      <h3 style="font-size: 15px; font-weight: 700; margin: 0 0 12px 0; color: #0f172a; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px;">Ordered Items</h3>
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
        <thead>
          <tr style="background-color: #f8fafc; color: #64748b; font-size: 12px; text-transform: uppercase;">
            <th style="padding: 8px; text-align: left;">Product</th>
            <th style="padding: 8px; text-align: center;">Qty</th>
            <th style="padding: 8px; text-align: right;">Price</th>
            <th style="padding: 8px; text-align: right;">Total</th>
          </tr>
        </thead>
        <tbody>
          ${itemsRowsHtml}
        </tbody>
      </table>

      <!-- Billing Summary -->
      <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
        <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
          <tr>
            <td style="padding: 4px 0; color: #64748b;">Subtotal:</td>
            <td style="padding: 4px 0; text-align: right; font-weight: 600; color: #0f172a;">₹${subtotal.toFixed(2)}</td>
          </tr>
          ${
            hasAnyOffers
              ? `
          <tr>
            <td style="padding: 4px 0; color: #15803d; font-weight: 600;">Active Offers Discount:</td>
            <td style="padding: 4px 0; text-align: right; font-weight: 700; color: #15803d;">-₹${totalOfferSavings.toFixed(2)}</td>
          </tr>`
              : ""
          }
          ${
            cgst > 0
              ? `
          <tr>
            <td style="padding: 4px 0; color: #64748b;">CGST:</td>
            <td style="padding: 4px 0; text-align: right; font-weight: 600; color: #0f172a;">+₹${cgst.toFixed(2)}</td>
          </tr>`
              : ""
          }
          ${
            sgst > 0
              ? `
          <tr>
            <td style="padding: 4px 0; color: #64748b;">SGST:</td>
            <td style="padding: 4px 0; text-align: right; font-weight: 600; color: #0f172a;">+₹${sgst.toFixed(2)}</td>
          </tr>`
              : ""
          }
          ${
            serviceCost > 0
              ? `
          <tr>
            <td style="padding: 4px 0; color: #64748b;">Service Charge:</td>
            <td style="padding: 4px 0; text-align: right; font-weight: 600; color: #0f172a;">+₹${serviceCost.toFixed(2)}</td>
          </tr>`
              : ""
          }
          ${
            isParcel
              ? `
          <tr>
            <td style="padding: 4px 0; color: #64748b;">Delivery Fee:</td>
            <td style="padding: 4px 0; text-align: right; font-weight: 600;">
              ${
                isFreeDelivery
                  ? '<span style="color: #059669; font-weight: 800; background: #dcfce7; padding: 2px 6px; border-radius: 4px; font-size: 11px;">FREE (Promo ≥ ₹200)</span>'
                  : `+₹${deliveryFee.toFixed(2)}`
              }
            </td>
          </tr>`
              : ""
          }
          <tr style="border-top: 1px solid #cbd5e1;">
            <td style="padding: 10px 0 0 0; font-weight: 800; font-size: 15px; color: #0f172a;">Total Order Amount:</td>
            <td style="padding: 10px 0 0 0; text-align: right; font-weight: 800; font-size: 18px; color: #2563eb;">₹${totalAmount.toFixed(2)}</td>
          </tr>
        </table>
      </div>

      <!-- Action Button -->
      <div style="text-align: center; margin: 28px 0 10px 0;">
        <a href="${appUrl}" style="background-color: #2563eb; color: #ffffff; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 700; font-size: 14px; display: inline-block; box-shadow: 0 4px 6px -1px rgba(37, 99, 235, 0.2);">
          Open Seller Dashboard & Manage Order
        </a>
      </div>
    </div>

    <!-- Footer -->
    <div style="background-color: #f1f5f9; padding: 16px 24px; text-align: center; font-size: 12px; color: #64748b; border-top: 1px solid #e2e8f0;">
      <div>Sent by your Store Notification Engine • Real-time Order Alert</div>
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
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json().catch(() => ({}));
    // Support both Supabase Database Webhook payload and direct invocation payload
    const orderRecord = body.record || body.order || null;
    const targetOrderId = body.orderId || body.order_id || orderRecord?.id;

    if (!targetOrderId) {
      return new Response(
        JSON.stringify({ error: "Missing orderId or record.id in request body." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 1. Fetch complete order details
    const { data: order, error: orderErr } = await supabase
      .from("orders")
      .select(`
        *,
        order_items (
          id,
          quantity,
          price,
          product_variant_combinations (
            id,
            combination_string,
            price,
            mrp,
            products (
              id,
              product_name,
              mrp,
              user_id
            )
          )
        )
      `)
      .eq("id", targetOrderId)
      .single();

    if (orderErr || !order) {
      throw new Error(`Failed to load order ${targetOrderId}: ${orderErr?.message}`);
    }

    // 2. Identify the seller
    const sellerId = order.seller_id || order.order_items?.[0]?.product_variant_combinations?.products?.user_id;

    if (!sellerId) {
      return new Response(
        JSON.stringify({ message: "No seller_id identified for this order. Skipping notification." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. Fetch Seller Profile (Email & Full Name)
    const { data: sellerProfile } = await supabase
      .from("profiles")
      .select("id, full_name, email, mobile")
      .eq("id", sellerId)
      .maybeSingle();

    const sellerEmail = sellerProfile?.email || null;
    const sellerName = sellerProfile?.full_name || "Store Owner";

    // 4. Calculate Offers & Line Items breakdown
    const parsedItems: ItemOfferInfo[] = (order.order_items || []).map((oi: any) => {
      const combo = oi.product_variant_combinations;
      const prod = combo?.products;
      const itemName = prod?.product_name || "Product";
      const variantStr = combo?.combination_string || "";
      const price = Number(oi.price || combo?.price || 0);
      const mrp = Number(combo?.mrp || prod?.mrp || 0) || null;
      const quantity = Number(oi.quantity || 1);
      const hasOffer = Boolean(mrp && mrp > price);
      const discountPercentage = hasOffer && mrp ? Math.round(((mrp - price) / mrp) * 100) : 0;
      const unitSavings = hasOffer && mrp ? mrp - price : 0;
      const totalSavings = unitSavings * quantity;
      const lineTotal = price * quantity;

      return {
        name: itemName,
        variant: variantStr,
        quantity,
        price,
        mrp,
        hasOffer,
        discountPercentage,
        unitSavings,
        totalSavings,
        lineTotal,
      };
    });

    const totalOfferSavings = parsedItems.reduce((acc, item) => acc + item.totalSavings, 0);
    const subtotal = Number(order.subtotal || parsedItems.reduce((acc, i) => acc + i.lineTotal, 0));
    const cgst = Number(order.cgst_amount || 0);
    const sgst = Number(order.sgst_amount || 0);
    const serviceCost = Number(order.service_cost || 0);
    const deliveryFee = Number(order.delivery_fee || 0);
    const isFreeDelivery = order.is_free_delivery === true || (deliveryFee === 0 && subtotal >= 200);
    const totalAmount = Number(order.total_amount || 0);
    const orderNumber = order.order_number || String(order.id).substring(0, 8).toUpperCase();
    const appUrl = Deno.env.get("PUBLIC_APP_URL") || "https://narasimhareddyaiapp2-localwala.github.io/needsTracking/";

    const shippingObj = typeof order.shipping_address === "object" ? order.shipping_address : null;
    const customerName = order.customer_name || shippingObj?.name || "";
    const customerMobile = order.customer_mobile || shippingObj?.mobile || "";
    const shippingAddress = typeof order.shipping_address === "string" ? order.shipping_address : shippingObj?.address || "";

    const notificationResults: { email?: unknown; push?: unknown } = {};

    // 5. Send Transactional Email to Seller via Resend or SMTP
    if (sellerEmail) {
      const emailSubject = totalOfferSavings > 0
        ? `🔥 [New Offer Order] #${orderNumber} • ₹${totalAmount.toFixed(2)} (Buyer saved ₹${totalOfferSavings.toFixed(2)})`
        : `📦 [New Order] #${orderNumber} • ₹${totalAmount.toFixed(2)} received`;

      const emailHtml = buildSellerOrderEmailHtml({
        sellerName,
        orderNumber,
        orderType: order.order_type || "shop-order",
        customerName,
        customerMobile,
        tableNo: order.table_no,
        shippingAddress,
        paymentMethod: order.payment_method || "cod",
        paymentReference: order.payment_reference,
        items: parsedItems,
        subtotal,
        totalOfferSavings,
        cgst,
        sgst,
        serviceCost,
        deliveryFee,
        isFreeDelivery,
        totalAmount,
        createdAt: new Date(order.created_at || Date.now()).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
        appUrl,
      });

      // Try Resend API first (default recommended in Supabase)
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
              to: [sellerEmail],
              subject: emailSubject,
              html: emailHtml,
            }),
          });
          notificationResults.email = await resendRes.json();
          console.log(`[send-seller-order-notification] Email sent via Resend to ${sellerEmail}`);
        } catch (resendErr: any) {
          console.error("Resend error:", resendErr);
          notificationResults.email = { error: resendErr?.message };
        }
      } else {
        console.log(`[send-seller-order-notification] Note: RESEND_API_KEY not configured. Template generated for ${sellerEmail}.`);
        notificationResults.email = { notice: "Email template ready. Set RESEND_API_KEY in Supabase secrets to dispatch automatically." };
      }
    }

    // 6. Send Web Browser & Mobile Push Notification to Seller
    const { data: sellerTokens } = await supabase
      .from("push_tokens")
      .select("token")
      .eq("user_id", sellerId);

    const rawTokens = (sellerTokens || []).map((t: any) => t.token).filter(Boolean);
    if (rawTokens.length > 0) {
      const pushTitle = totalOfferSavings > 0
        ? `🔥 New Offer Order #${orderNumber}!`
        : `🛒 New Order #${orderNumber}!`;

      const pushBody = totalOfferSavings > 0
        ? `₹${totalAmount.toFixed(2)} • Customer saved ₹${totalOfferSavings.toFixed(2)} with special offers!`
        : `₹${totalAmount.toFixed(2)} • ${customerName || "Customer"} placed an order.`;

      const pushPayload = { orderId: order.id, type: "new_order_seller" };

      // Dispatch to Expo Mobile push
      const expoTokens = rawTokens.filter((t: string) => t.startsWith("ExponentPushToken") || t.startsWith("ExpoPushToken"));
      if (expoTokens.length > 0) {
        try {
          await fetch(EXPO_PUSH_ENDPOINT, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              to: expoTokens,
              title: pushTitle,
              body: pushBody,
              sound: "default",
              data: pushPayload,
            }),
          });
        } catch (e) {
          console.warn("Expo push delivery error:", e);
        }
      }

      notificationResults.push = { tokensCount: rawTokens.length };
    }

    return new Response(
      JSON.stringify({
        success: true,
        orderId: order.id,
        sellerId,
        sellerEmail,
        hasOffers: totalOfferSavings > 0,
        totalOfferSavings,
        notificationResults,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err: any) {
    console.error("Error in send-seller-order-notification:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
