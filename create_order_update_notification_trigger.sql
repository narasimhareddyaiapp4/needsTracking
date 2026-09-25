-- Drop existing trigger and function if they exist to allow recreation
DROP TRIGGER IF EXISTS order_status_update_notification_trigger ON public.orders;
DROP FUNCTION IF EXISTS public.notify_order_update CASCADE;

-- Name: create_order_update_notification_trigger.sql
-- Desc: Creates a trigger to call an edge function when an order's status is updated.

-- This function will be called by the trigger.
-- It sends a POST request to the 'notify-order-update' edge function.
CREATE OR REPLACE FUNCTION public.notify_order_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- IMPORTANT: Replace YOUR_SERVICE_ROLE_KEY with your actual Supabase service_role key.
  -- You can find your service_role key in your Supabase project settings under API.
  -- It is recommended to store this key in a secure way, for example, using Supabase secrets.
  PERFORM net.http_post(
    url:='https://cikxysaxvbixrcwlgzds.supabase.co/functions/v1/notify-order-update',
    headers:='{"Content-Type": "application/json", "Authorization": "Bearer YOUR_SERVICE_ROLE_KEY"}'::jsonb,
    body:=jsonb_build_object(
      'type', 'ORDER_STATUS_UPDATE',
      'record', row_to_json(NEW),
      'old_record', row_to_json(OLD)
    )
  );
  RETURN NEW;
END;
$$;

-- This trigger will fire after the 'status' column of an order is updated.
CREATE TRIGGER order_status_update_notification_trigger
AFTER UPDATE OF status ON public.orders
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION public.notify_order_update();

COMMENT ON FUNCTION public.notify_order_update IS 'Calls the notify-order-update edge function when an order status changes.';
COMMENT ON TRIGGER order_status_update_notification_trigger ON public.orders IS 'Fires after an order status is updated to send a notification.';
