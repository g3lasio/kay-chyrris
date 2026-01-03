import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Megaphone, Send, Users, Loader2, CheckCircle2, XCircle } from "lucide-react";

type CampaignType = 'announcement' | 'event' | 'update' | 'offer';
type TargetAudience = 'all' | 'free' | 'patron' | 'master';

export default function Announcements() {
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [type, setType] = useState<CampaignType>("announcement");
  const [targetAudience, setTargetAudience] = useState<TargetAudience>("all");

  const sendCampaignMutation = trpc.notifications.sendCampaign.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        toast.success(`Campaign sent successfully! ${data.sentCount} emails delivered.`);
        setTitle("");
        setMessage("");
        setType("announcement");
        setTargetAudience("all");
      } else {
        toast.error(`Failed to send campaign: ${data.error}`);
      }
    },
    onError: (error) => {
      toast.error(`Error: ${error.message}`);
    },
  });

  const campaignsQuery = trpc.notifications.getCampaigns.useQuery();

  const handleSend = () => {
    if (!title.trim() || !message.trim()) {
      toast.error("Please fill in title and message");
      return;
    }

    sendCampaignMutation.mutate({
      title,
      message,
      type,
      targetAudience,
      applicationId: 1, // Owl Fenc
    });
  };

  const getTypeColor = (t: string) => {
    const colors: Record<string, string> = {
      announcement: "text-blue-400",
      event: "text-purple-400",
      update: "text-green-400",
      offer: "text-orange-400",
    };
    return colors[t] || "text-gray-400";
  };

  const getAudienceLabel = (audience: string) => {
    const labels: Record<string, string> = {
      all: "All Users",
      free: "Free Users Only",
      patron: "Patron Users Only",
      master: "Master Users Only",
    };
    return labels[audience] || audience;
  };

  return (
    <div className="space-y-8 p-8">
      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="p-3 rounded-xl bg-gradient-to-br from-purple-500/20 to-pink-500/20 border border-purple-500/30">
          <Megaphone className="w-8 h-8 text-purple-400" />
        </div>
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
            Mass Announcements
          </h1>
          <p className="text-muted-foreground">Send notifications to all users or specific segments</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Create Campaign */}
        <Card className="futuristic-card">
          <CardHeader>
            <CardTitle>Create New Campaign</CardTitle>
            <CardDescription>Compose and send a message to your users</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Title */}
            <div className="space-y-2">
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                placeholder="e.g., New Feature Released!"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="futuristic-input"
              />
            </div>

            {/* Message */}
            <div className="space-y-2">
              <Label htmlFor="message">Message</Label>
              <Textarea
                id="message"
                placeholder="Write your announcement message here..."
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={6}
                className="futuristic-input resize-none"
              />
            </div>

            {/* Type */}
            <div className="space-y-2">
              <Label htmlFor="type">Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as CampaignType)}>
                <SelectTrigger id="type" className="futuristic-input">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="announcement">📢 Announcement</SelectItem>
                  <SelectItem value="event">📅 Event</SelectItem>
                  <SelectItem value="update">🔄 Update</SelectItem>
                  <SelectItem value="offer">🎁 Offer</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Target Audience */}
            <div className="space-y-2">
              <Label htmlFor="audience">Target Audience</Label>
              <Select value={targetAudience} onValueChange={(v) => setTargetAudience(v as TargetAudience)}>
                <SelectTrigger id="audience" className="futuristic-input">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">👥 All Users</SelectItem>
                  <SelectItem value="free">🆓 Free Users Only</SelectItem>
                  <SelectItem value="patron">⭐ Patron Users Only</SelectItem>
                  <SelectItem value="master">👑 Master Users Only</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Send Button */}
            <Button
              onClick={handleSend}
              disabled={sendCampaignMutation.isPending}
              className="w-full futuristic-button"
            >
              {sendCampaignMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Send className="w-4 h-4 mr-2" />
                  Send Campaign
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Campaign History */}
        <Card className="futuristic-card">
          <CardHeader>
            <CardTitle>Campaign History</CardTitle>
            <CardDescription>Recent announcements sent to users</CardDescription>
          </CardHeader>
          <CardContent>
            {campaignsQuery.isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
              </div>
            ) : campaignsQuery.data && campaignsQuery.data.length > 0 ? (
              <div className="space-y-4 max-h-[600px] overflow-y-auto pr-2">
                {campaignsQuery.data.map((campaign: any) => (
                  <div
                    key={campaign.id}
                    className="p-4 rounded-lg border border-border/50 bg-card/50 hover:bg-card/80 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 space-y-2">
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold">{campaign.name}</h3>
                          <span className={`text-xs uppercase font-bold ${getTypeColor(campaign.type || 'announcement')}`}>
                            {campaign.type || 'announcement'}
                          </span>
                        </div>
                        <p className="text-sm text-muted-foreground line-clamp-2">{campaign.message}</p>
                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Users className="w-3 h-3" />
                            {getAudienceLabel(campaign.targetSegment?.plan?.[0] || 'all')}
                          </span>
                          <span className="flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3 text-green-400" />
                            {campaign.successfulSends || 0} sent
                          </span>
                          {(campaign.failedSends || 0) > 0 && (
                            <span className="flex items-center gap-1">
                              <XCircle className="w-3 h-3 text-red-400" />
                              {campaign.failedSends} failed
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {new Date(campaign.createdAt).toLocaleString()}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                <Megaphone className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>No campaigns sent yet</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
