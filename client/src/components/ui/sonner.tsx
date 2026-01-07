import { Toaster as Sonner } from "sonner";

function Toaster() {
  return (
    <Sonner
      theme="dark"
      position="top-right"
      richColors
      expand={true}
      visibleToasts={5}
      toastOptions={{
        style: {
          background: 'hsl(var(--popover))',
          color: 'hsl(var(--popover-foreground))',
          border: '1px solid hsl(var(--border))',
          zIndex: 99999,
        },
        className: 'sonner-toast',
      }}
      style={{
        zIndex: 99999,
      }}
    />
  );
}

export { Toaster };
