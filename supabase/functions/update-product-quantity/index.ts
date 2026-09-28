import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeaders } from '../_shared/cors.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? '';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const order_id = body?.order_id;

    if (!order_id) {
      return new Response(JSON.stringify({ error: 'Missing order_id' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!supabaseUrl || !serviceRoleKey) {
      return new Response(JSON.stringify({ error: 'Supabase configuration missing' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Use the service role key to bypass RLS policies
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { data: orderItems, error: orderItemsError } = await supabase
      .from('order_items')
      .select('product_variant_combination_id, quantity')
      .eq('order_id', order_id);

    if (orderItemsError) {
      console.error('Error fetching order items:', orderItemsError);
      return new Response(JSON.stringify({ error: 'Error fetching order items' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    for (const item of (orderItems || [])) {
      if (!item.product_variant_combination_id) continue;

      const { data: variant, error: variantError } = await supabase
        .from('product_variant_combinations')
        .select('quantity')
        .eq('id', item.product_variant_combination_id)
        .single();

      if (variantError || !variant) {
        console.error('Error fetching variant quantity:', variantError);
        continue;
      }

      const oldQuantity = variant.quantity || 0;
      const newQuantity = oldQuantity - item.quantity;

      const { error: updateError } = await supabase
        .from('product_variant_combinations')
        .update({ quantity: newQuantity })
        .eq('id', item.product_variant_combination_id);

      if (updateError) {
        console.error('Error updating variant quantity:', updateError);
      } else {
        const { error: historyError } = await supabase
          .from('inventory_history')
          .insert({
            product_variant_combination_id: item.product_variant_combination_id,
            change_type: 'sale',
            quantity_change: -item.quantity,
            new_quantity: newQuantity,
            order_id: order_id,
          });

        if (historyError) {
          console.error('Error inserting into inventory history:', historyError);
        }

        // Trigger Low Stock or Out-of-Stock alert to seller & staff
        const isTransitionToLow = oldQuantity > 5 && newQuantity <= 5 && newQuantity > 0;
        const isTransitionToOut = oldQuantity > 0 && newQuantity <= 0;
        if (isTransitionToLow || isTransitionToOut) {
          try {
            console.log(`[update-product-quantity] Triggering stock alert for variant ${item.product_variant_combination_id} (old: ${oldQuantity}, new: ${newQuantity})`);
            await supabase.functions.invoke('send-stock-alert', {
              body: {
                product_variant_combination_id: item.product_variant_combination_id,
                old_quantity: oldQuantity,
                new_quantity: newQuantity,
                threshold: 5,
              },
            });
          } catch (alertErr) {
            console.warn('[update-product-quantity] Stock alert invocation notice:', alertErr);
          }
        }
      }
    }

    return new Response(JSON.stringify({ success: true, message: 'Inventory updated' }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('update-product-quantity error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});