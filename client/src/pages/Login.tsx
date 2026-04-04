import { useState } from 'react';
import { useLocation } from 'wouter';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { Loader2, Shield, Sparkles } from 'lucide-react';

export default function Login() {
  const [, setLocation] = useLocation();
  const [passcode, setPasscode] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const verifyPasscodeMutation = trpc.auth.verifyPasscode.useMutation();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!passcode.trim()) {
      toast.error('Please enter the admin passcode');
      return;
    }

    setIsLoading(true);

    try {
      const result = await verifyPasscodeMutation.mutateAsync({ passcode });

      if (result.success) {
        toast.success('Welcome to Chyrris KAI');
        setLocation('/');
      } else {
        toast.error(result.error || 'Invalid passcode');
      }
    } catch (error: any) {
      toast.error(error.message || 'Something went wrong');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
      {/* Animated background elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/10 rounded-full blur-3xl animate-float" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-secondary/10 rounded-full blur-3xl animate-float" style={{ animationDelay: '1s' }} />
      </div>

      <Card className="w-full max-w-md relative z-10 card-glow border-primary/20 bg-card/95 backdrop-blur-xl">
        <CardHeader className="space-y-4 text-center">
          <div className="mx-auto w-16 h-16 bg-gradient-to-br from-primary to-secondary rounded-2xl flex items-center justify-center animate-glow">
            <Shield className="w-8 h-8 text-primary-foreground" />
          </div>
          <div className="space-y-2">
            <CardTitle className="text-3xl font-bold gradient-text">
              Chyrris KAI
            </CardTitle>
            <CardDescription className="text-muted-foreground flex items-center justify-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" />
              Admin Control System
              <Sparkles className="w-4 h-4 text-secondary" />
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent>
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="passcode" className="text-sm font-medium text-foreground">
                Admin Passcode
              </label>
              <Input
                id="passcode"
                type="password"
                placeholder="Enter passcode"
                value={passcode}
                onChange={(e) => setPasscode(e.target.value)}
                className="h-12 bg-input border-border focus:border-primary transition-all text-center text-xl tracking-widest"
                disabled={isLoading}
                autoFocus
                autoComplete="current-password"
              />
            </div>

            <Button
              type="submit"
              className="w-full h-12 text-base font-semibold btn-futuristic"
              disabled={isLoading || !passcode.trim()}
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  Verifying...
                </>
              ) : (
                'Access Admin Panel'
              )}
            </Button>
          </form>

          <div className="mt-6 pt-6 border-t border-border/50 text-center">
            <p className="text-xs text-muted-foreground">
              Secure admin access for Owl Fenc management
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
