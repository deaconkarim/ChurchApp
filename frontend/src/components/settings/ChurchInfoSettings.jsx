import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Save, Building, Mail, Phone, Globe, MapPin, User, Link as LinkIcon, CheckCircle, AlertCircle } from 'lucide-react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/supabaseClient'; 

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.05 } }
};

const itemVariants = {
  hidden: { y: 20, opacity: 0 },
  visible: { y: 0, opacity: 1, transition: { type: "spring", stiffness: 100 } }
};

// Helper function to get current user's organization ID
const getCurrentUserOrganizationId = async () => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const { data, error } = await supabase
      .from('organization_users')
      .select('organization_id')
      .eq('user_id', user.id)
      .eq('approval_status', 'approved')
      .limit(1);

    if (error) throw error;
    return data && data.length > 0 ? data[0].organization_id : null;
  } catch (error) {
    console.error('Error getting user organization:', error);
    return null;
  }
};

const ChurchInfoSettings = () => {
  const [churchSettings, setChurchSettings] = useState({
    name: '',
    email: '',
    phone: '',
    website: '',
    address: '',
    pastor: ''
  });
  const [isLoading, setIsLoading] = useState(false);
  const [organizationId, setOrganizationId] = useState(null);
  const { toast } = useToast();
  const [stripeStatus, setStripeStatus] = useState({ connected: false, loading: false, error: null });

  const handleChurchSettingsChange = (e) => {
    const { name, value } = e.target;
    setChurchSettings(prev => ({ ...prev, [name]: value }));
  };

  const handleSaveChurchSettings = async () => {
    if (!organizationId) {
      toast({
        title: "Error",
        description: "Unable to determine your organization.",
        variant: "destructive"
      });
      return;
    }

    setIsLoading(true);
    
    try {
      // Convert settings object to key-value pairs for the database
      const settingsToSave = Object.entries(churchSettings).map(([key, value]) => ({
        setting_key: key,
        setting_value: value,
        organization_id: organizationId
      }));

      // Use upsert to save all settings
      const { error } = await supabase
        .from('church_settings')
        .upsert(settingsToSave, { onConflict: 'setting_key,organization_id' });

      if (error) throw error;

      toast({
        title: "Settings Saved",
        description: "Church information has been updated successfully."
      });
    } catch (error) {
      toast({
        title: "Error Saving Settings",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };
  
  useEffect(() => {
    const fetchChurchSettings = async () => {
      setIsLoading(true);
      try {
        // First get the user's organization ID
        const orgId = await getCurrentUserOrganizationId();
        if (!orgId) {
          toast({
            title: "Error",
            description: "Unable to determine your organization.",
            variant: "destructive"
          });
          return;
        }
        setOrganizationId(orgId);

        // Fetch organization details
        const { data: orgData, error: orgError } = await supabase
          .from('organizations')
          .select('name, email, phone, website, address')
          .eq('id', orgId)
          .single();

        if (orgError) throw orgError;

        // Fetch church settings
        const { data, error } = await supabase
          .from('church_settings')
          .select('setting_key, setting_value')
          .eq('organization_id', orgId);

        if (error) throw error;

        // Start with organization data as defaults
        const settingsObject = {
          name: orgData?.name || '',
          email: orgData?.email || '',
          phone: orgData?.phone || '',
          website: orgData?.website || '',
          address: orgData?.address ? JSON.stringify(orgData.address) : '',
          pastor: ''
        };

        // Override with any saved settings
        if (data && data.length > 0) {
          data.forEach(item => {
            settingsObject[item.setting_key] = item.setting_value;
          });
        }

        setChurchSettings(settingsObject);
      } catch (error) {
        console.error("Error fetching church settings:", error);
        toast({
          title: "Error Loading Settings",
          description: "Unable to load church settings.",
          variant: "destructive"
        });
      } finally {
        setIsLoading(false);
      }
    };
    fetchChurchSettings();
  }, [toast]);

  // Fetch Stripe Connect status
  useEffect(() => {
    if (!organizationId) return;
    const fetchStripeStatus = async () => {
      setStripeStatus(s => ({ ...s, loading: true }));
      const { data, error } = await supabase
        .from('organizations')
        .select('stripe_account_id')
        .eq('id', organizationId)
        .single();
      if (error) {
        setStripeStatus({ connected: false, loading: false, error: error.message });
      } else {
        setStripeStatus({ connected: !!data?.stripe_account_id, loading: false, error: null });
      }
    };
    fetchStripeStatus();
  }, [organizationId]);

  // Stripe Connect onboarding handler
  const handleStripeConnect = async () => {
    setStripeStatus(s => ({ ...s, loading: true, error: null }));
    try {
      const email = churchSettings.email || '';
      const res = await fetch('/api/stripe/onboard-church', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organization_id: organizationId, email }),
      });
      const result = await res.json();
      if (result.url) {
        window.location.href = result.url;
      } else {
        setStripeStatus(s => ({ ...s, loading: false, error: result.error || 'Failed to start onboarding.' }));
      }
    } catch (err) {
      setStripeStatus(s => ({ ...s, loading: false, error: err.message }));
    }
  };

  if (!organizationId && !isLoading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-center text-muted-foreground">
            Unable to load church settings. Please make sure you are associated with an organization.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <motion.div variants={containerVariants} initial="hidden" animate="visible">
      <Card>
        <CardHeader>
          <CardTitle>Church Information</CardTitle>
          <CardDescription>Update your church's basic information.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Stripe Connect Setup Guide */}
          <div className="mb-6 p-4 bg-blue-50 rounded-lg border border-blue-200">
            <div className="mb-2 text-blue-900 font-semibold text-lg flex items-center gap-2">
              <LinkIcon className="w-5 h-5 text-blue-600" />
              Accept Online Donations & Payouts
            </div>
            <ol className="list-decimal ml-6 space-y-1 text-blue-900">
              <li><b>Click “Connect Payouts (Stripe)” below.</b></li>
              <li><b>Follow the Stripe onboarding process</b> to securely enter your church’s bank info.</li>
              <li><b>Done!</b> You’ll be able to receive donations directly to your bank account.</li>
            </ol>
            <div className="mt-3 p-3 bg-white rounded text-blue-900 border border-blue-100">
              <b>What is Stripe Connect?</b><br />
              Stripe Connect is a secure, industry-standard way for platforms like Deacon to send donations directly to your church’s bank account. <a href="https://stripe.com/connect" target="_blank" rel="noopener noreferrer" className="underline">Learn more</a>.
            </div>
            <div className="mt-2 text-sm text-blue-800">
              <b>Need help?</b> <a href="mailto:support@yourapp.com" className="underline">Contact support</a>
            </div>
          </div>
          {/* Stripe Connect status and button */}
          <div className="mb-4">
            <Label>Payouts (Stripe Connect)</Label>
            <div className="flex items-center gap-3 mt-1">
              {stripeStatus.loading ? (
                <span className="text-blue-600">Checking status...</span>
              ) : stripeStatus.connected ? (
                <span className="flex items-center text-green-600"><CheckCircle className="w-4 h-4 mr-1" /> Connected — Donations will be paid out to your bank account.</span>
              ) : (
                <span className="flex items-center text-red-600"><AlertCircle className="w-4 h-4 mr-1" /> Not Connected — You must connect to receive online donations.</span>
              )}
              <Button
                variant={stripeStatus.connected ? 'outline' : 'default'}
                size="sm"
                onClick={handleStripeConnect}
                disabled={stripeStatus.loading}
                className="ml-2"
              >
                {stripeStatus.connected ? 'Update Payout Info' : 'Connect Payouts (Stripe)'}
                <LinkIcon className="w-4 h-4 ml-2" />
              </Button>
            </div>
            {stripeStatus.error && <div className="text-red-600 text-xs mt-1">{stripeStatus.error} <br />If this keeps happening, please contact support.</div>}
          </div>
          <motion.div variants={itemVariants} className="space-y-2">
            <Label htmlFor="church-name">Church Name</Label>
            <div className="flex items-center">
              <Building className="mr-2 h-4 w-4 text-muted-foreground" />
              <Input 
                id="church-name" 
                name="name" 
                value={churchSettings.name} 
                onChange={handleChurchSettingsChange}
                disabled={isLoading}
              />
            </div>
          </motion.div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <motion.div variants={itemVariants} className="space-y-2">
              <Label htmlFor="church-email">Email Address</Label>
              <div className="flex items-center">
                <Mail className="mr-2 h-4 w-4 text-muted-foreground" />
                <Input 
                  id="church-email" 
                  name="email" 
                  type="email" 
                  value={churchSettings.email} 
                  onChange={handleChurchSettingsChange}
                  disabled={isLoading}
                />
              </div>
            </motion.div>
            
            <motion.div variants={itemVariants} className="space-y-2">
              <Label htmlFor="church-phone">Phone Number</Label>
              <div className="flex items-center">
                <Phone className="mr-2 h-4 w-4 text-muted-foreground" />
                <Input 
                  id="church-phone" 
                  name="phone" 
                  value={churchSettings.phone} 
                  onChange={handleChurchSettingsChange}
                  disabled={isLoading}
                />
              </div>
            </motion.div>
          </div>
          
          <motion.div variants={itemVariants} className="space-y-2">
            <Label htmlFor="church-website">Website</Label>
            <div className="flex items-center">
              <Globe className="mr-2 h-4 w-4 text-muted-foreground" />
              <Input 
                id="church-website" 
                name="website" 
                value={churchSettings.website} 
                onChange={handleChurchSettingsChange}
                disabled={isLoading}
              />
            </div>
          </motion.div>
          
          <motion.div variants={itemVariants} className="space-y-2">
            <Label htmlFor="church-address">Address</Label>
            <div className="flex items-center">
              <MapPin className="mr-2 h-4 w-4 text-muted-foreground" />
              <Input 
                id="church-address" 
                name="address" 
                value={churchSettings.address} 
                onChange={handleChurchSettingsChange}
                disabled={isLoading}
              />
            </div>
          </motion.div>
          
          <motion.div variants={itemVariants} className="space-y-2">
            <Label htmlFor="church-pastor">Lead Pastor</Label>
            <div className="flex items-center">
              <User className="mr-2 h-4 w-4 text-muted-foreground" />
              <Input 
                id="church-pastor" 
                name="pastor" 
                value={churchSettings.pastor} 
                onChange={handleChurchSettingsChange}
                disabled={isLoading}
              />
            </div>
          </motion.div>
        </CardContent>
        <CardFooter>
          <Button onClick={handleSaveChurchSettings} disabled={isLoading || !organizationId}>
            <Save className="mr-2 h-4 w-4" />
            {isLoading ? 'Saving...' : 'Save Changes'}
          </Button>
        </CardFooter>
      </Card>
    </motion.div>
  );
};

export default ChurchInfoSettings;