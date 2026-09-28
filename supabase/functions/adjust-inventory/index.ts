import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeaders } from '../_shared/cors.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? '';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { product_variant_combination_id, new_quantity, notes } = await req.json();

    if (!product_variant_combination_id || new_quantity === undefined) {
      return new Response(JSON.stringify({ error: 'Missing product_variant_combination_id or new_quantity' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

  const { data: variant, error: variantError } = await supabase
    .from('product_variant_combinations')
    .select('quantity')
    .eq('id', product_variant_combination_id)
    .single()

  if (variantError) {
    console.error('Error fetching variant quantity:', variantError)
    return new Response('Error fetching variant quantity', { status: 500 })
  }

  const quantity_change = new_quantity - variant.quantity

  const { error: updateError } = await supabase
    .from('product_variant_combinations')
    .update({ quantity: new_quantity })
    .eq('id', product_variant_combination_id)

    if (updateError) {
      console.error('Error updating variant quantity:', updateError);
      return new Response(JSON.stringify({ error: 'Error updating variant quantity' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { error: historyError } = await supabase
      .from('inventory_history')
      .insert({
        product_variant_combination_id,
        change_type: 'manual_adjustment',
        quantity_change,
        new_quantity,
        notes,
      });

    if (historyError) {
      console.error('Error inserting into inventory history:', historyError);
      return new Response(JSON.stringify({ error: 'Error inserting into inventory history' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Trigger stock alert if stock reached low (<= 5) or out-of-stock (<= 0)
    const oldQuantity = variant.quantity || 0;
    const isTransitionToLow = oldQuantity > 5 && new_quantity <= 5 && new_quantity > 0;
    const isTransitionToOut = oldQuantity > 0 && new_quantity <= 0;
    if (isTransitionToLow || isTransitionToOut) {
      try {
        console.log(`[adjust-inventory] Triggering stock alert for variant ${product_variant_combination_id} (old: ${oldQuantity}, new: ${new_quantity})`);
        await supabase.functions.invoke('send-stock-alert', {
          body: {
            product_variant_combination_id,
            old_quantity: oldQuantity,
            new_quantity,
            threshold: 5,
          },
        });
      } catch (alertErr) {
        console.warn('[adjust-inventory] Stock alert notice:', alertErr);
      }
    }

    return new Response(JSON.stringify({ success: true, message: 'Inventory adjusted' }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('adjust-inventory error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
