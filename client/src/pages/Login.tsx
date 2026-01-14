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
  const [step, setStep] = useState<'email' | 'otp'>('email');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const sendOTPMutation = trpc.auth.sendOTP.useMutation();
  const verifyOTPMutation = trpc.auth.verifyOTP.useMutation();

  const handleSendOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast.error('Please enter a valid email address');
      return;
    }

    setIsLoading(true);
    
    try {
      const result = await sendOTPMutation.mutateAsync({ email });
      
      if (result.success) {
        toast.success(result.message || `Login code sent to ${email}`);
        setStep('otp');
      } else {
        // Show specific error message from backend
        if (result.error === 'Email not registered') {
          toast.error(result.message || 'This email is not registered. Please contact an administrator.');
        } else {
          toast.error(result.message || result.error || 'Failed to send code');
        }
      }
    } catch (error: any) {
      toast.error(error.message || 'Something went wrong');
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!otp || otp.length !== 6) {
      toast.error('Please enter the 6-digit code');
      return;
    }

    setIsLoading(true);
    
    try {
      const result = await verifyOTPMutation.mutateAsync({ email, code: otp });
      
      if (result.success) {
        toast.success('Welcome to Chyrris KAI');
        setLocation('/');
      } else {
        toast.error(result.error || 'Invalid code');
      }
    } catch (error: any) {
      toast.error(error.message || 'Something went wrong');
    } finally {
      setIsLoading(false);
    }
  };

  const handleBackToEmail = () => {
    setStep('email');
    setOtp('');
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
          {step === 'email' ? (
            <form onSubmit={handleSendOTP} className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="email" className="text-sm font-medium text-foreground">
                  Email Address
                </label>
                <Input
                  id="email"
                  type="email"
                  placeholder="admin@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-12 bg-input border-border focus:border-primary transition-all"
                  disabled={isLoading}
                  autoFocus
                />
              </div>
              
              <Button 
                type="submit" 
                className="w-full h-12 text-base font-semibold btn-futuristic"
                disabled={isLoading}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    Sending Code...
                  </>
                ) : (
                  'Send Login Code'
                )}
              </Button>
            </form>
          ) : (
            <form onSubmit={handleVerifyOTP} className="space-y-6">
              <div className="space-y-4">
                <div className="text-center space-y-2">
                  <label className="text-sm font-medium text-foreground">
                    Enter Verification Code
                  </label>
                  <p className="text-sm text-muted-foreground">
                    We sent a 6-digit code to{' '}
                    <span className="text-primary font-medium">{email}</span>
                  </p>
                </div>

                <Input
                  id="otp"
                  type="text"
                  placeholder="000000"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="text-center text-3xl font-mono tracking-widest h-16 bg-input border-primary/30 focus:border-primary transition-all"
                  disabled={isLoading}
                  autoFocus
                  maxLength={6}
                />
              </div>
              
              <div className="space-y-3">
                <Button 
                  type="submit" 
                  className="w-full h-12 text-base font-semibold btn-futuristic"
                  disabled={isLoading || otp.length !== 6}
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                      Verifying...
                    </>
                  ) : (
                    'Verify & Login'
                  )}
                </Button>
                
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full text-muted-foreground hover:text-primary transition-colors"
                  onClick={handleBackToEmail}
                  disabled={isLoading}
                >
                  Use different email
                </Button>
              </div>
            </form>
          )}
          
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
