import { useState, useRef } from 'react';
import { PageHeader } from '@/components/layout/Shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Settings2, BookOpen, Plus, Trash2, FileText, Upload, Database,
  Save, Loader2, FileUp, RefreshCw,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetAiSettings, useUpdateAiSettings,
  useListKnowledgeBase, useCreateKnowledgeBaseEntry, useDeleteKnowledgeBaseEntry,
  useImportDocumentToKnowledgeBase, useListAllDocuments,
  getGetAiSettingsQueryKey, getListKnowledgeBaseQueryKey,
} from '@workspace/api-client-react';
import { format } from 'date-fns';
import { useToast } from '@/hooks/use-toast';

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

const MODELS = [
  { value: 'gpt-5.6-terra', label: 'GPT-5.6 Terra (Best quality)' },
  { value: 'gpt-5.6-luna', label: 'GPT-5.6 Luna (Faster, cost-effective)' },
  { value: 'gpt-5.4-mini', label: 'GPT-5.4 Mini (Lightweight)' },
];

export default function AiSettingsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();

  // Settings
  const { data: settings, isLoading: settingsLoading } = useGetAiSettings();
  const updateSettings = useUpdateAiSettings();
  const [model, setModel] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [settingsDirty, setSettingsDirty] = useState(false);

  // sync settings into local state once loaded
  const [synced, setSynced] = useState(false);
  if (settings && !synced) {
    setModel(settings.model);
    setSystemPrompt(settings.systemPrompt);
    setSynced(true);
  }

  // Knowledge base
  const { data: kbEntries, isLoading: kbLoading } = useListKnowledgeBase();
  const createEntry = useCreateKnowledgeBaseEntry();
  const deleteEntry = useDeleteKnowledgeBaseEntry();
  const importDoc = useImportDocumentToKnowledgeBase();
  const { data: documents } = useListAllDocuments();

  // Add-text dialog
  const [textDialogOpen, setTextDialogOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [addingText, setAddingText] = useState(false);

  // Import-doc dialog
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [selectedDocId, setSelectedDocId] = useState('');
  const [importing, setImporting] = useState(false);

  // Delete confirm
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);

  // File upload
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const invalidateKb = () =>
    qc.invalidateQueries({ queryKey: getListKnowledgeBaseQueryKey() });

  const handleSaveSettings = () => {
    updateSettings.mutate(
      { data: { model, systemPrompt } },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getGetAiSettingsQueryKey() });
          setSettingsDirty(false);
          toast({ title: 'Settings saved' });
        },
        onError: () => toast({ title: 'Failed to save settings', variant: 'destructive' }),
      },
    );
  };

  const handleAddText = async () => {
    if (!newTitle.trim() || !newContent.trim()) return;
    setAddingText(true);
    createEntry.mutate(
      { data: { title: newTitle.trim(), content: newContent.trim(), sourceType: 'paste' } },
      {
        onSuccess: () => {
          invalidateKb();
          setTextDialogOpen(false);
          setNewTitle('');
          setNewContent('');
          toast({ title: 'Entry added to knowledge base' });
        },
        onError: () => toast({ title: 'Failed to add entry', variant: 'destructive' }),
        onSettled: () => setAddingText(false),
      },
    );
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);

    try {
      const isPdf = file.type === 'application/pdf' || file.name.endsWith('.pdf');

      if (isPdf) {
        // Send to server for PDF text extraction
        const formData = new FormData();
        formData.append('file', file);
        const res = await fetch(`${BASE}/api/ai/knowledge-base/upload`, {
          method: 'POST',
          body: formData,
        });
        if (!res.ok) throw new Error('Upload failed');
        await invalidateKb();
        toast({ title: `"${file.name}" added to knowledge base` });
      } else {
        // Read text file directly
        const text = await file.text();
        createEntry.mutate(
          {
            data: {
              title: file.name,
              content: text,
              sourceType: 'upload',
              fileName: file.name,
              fileSize: file.size,
            },
          },
          {
            onSuccess: () => {
              invalidateKb();
              toast({ title: `"${file.name}" added to knowledge base` });
            },
            onError: () => toast({ title: 'Failed to add file', variant: 'destructive' }),
          },
        );
      }
    } catch {
      toast({ title: 'File upload failed', variant: 'destructive' });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleImportDoc = async () => {
    if (!selectedDocId) return;
    setImporting(true);
    importDoc.mutate(
      { documentId: Number(selectedDocId) },
      {
        onSuccess: () => {
          invalidateKb();
          setImportDialogOpen(false);
          setSelectedDocId('');
          toast({ title: 'Document imported to knowledge base' });
        },
        onError: () => toast({ title: 'Failed to import document', variant: 'destructive' }),
        onSettled: () => setImporting(false),
      },
    );
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleting(true);
    deleteEntry.mutate(
      { id: deleteId },
      {
        onSuccess: () => {
          invalidateKb();
          setDeleteId(null);
          toast({ title: 'Entry removed' });
        },
        onError: () => toast({ title: 'Failed to remove entry', variant: 'destructive' }),
        onSettled: () => setDeleting(false),
      },
    );
  };

  const sourceIcon = (type: string) => {
    if (type === 'upload') return <FileUp className="h-3.5 w-3.5" />;
    if (type === 'document') return <Database className="h-3.5 w-3.5" />;
    return <FileText className="h-3.5 w-3.5" />;
  };

  const sourceLabel = (type: string) => {
    if (type === 'upload') return 'File upload';
    if (type === 'document') return 'Imported doc';
    return 'Pasted text';
  };

  return (
    <div className="flex-1 flex flex-col h-screen overflow-auto">
      <PageHeader
        title="AI Settings"
        description="Configure the AI assistant and manage its knowledge base."
      />

      <div className="flex-1 p-6 max-w-4xl">
        <Tabs defaultValue="settings">
          <TabsList className="mb-6">
            <TabsTrigger value="settings" className="gap-2">
              <Settings2 className="h-4 w-4" />
              Configuration
            </TabsTrigger>
            <TabsTrigger value="knowledge" className="gap-2">
              <BookOpen className="h-4 w-4" />
              Knowledge Base
              {kbEntries && kbEntries.length > 0 && (
                <Badge variant="secondary" className="ml-1">{kbEntries.length}</Badge>
              )}
            </TabsTrigger>
          </TabsList>

          {/* ── Configuration Tab ── */}
          <TabsContent value="settings">
            <Card>
              <CardHeader>
                <CardTitle>AI Model & Behaviour</CardTitle>
                <CardDescription>
                  Choose the AI model and define how the assistant should behave.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {settingsLoading ? (
                  <div className="flex items-center gap-2 text-muted-foreground py-8 justify-center">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading settings…
                  </div>
                ) : (
                  <>
                    <div className="space-y-2">
                      <Label>AI Model</Label>
                      <Select
                        value={model}
                        onValueChange={v => { setModel(v); setSettingsDirty(true); }}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select model…" />
                        </SelectTrigger>
                        <SelectContent>
                          {MODELS.map(m => (
                            <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        Terra gives the best legal reasoning; Luna is faster for routine queries.
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label>System Prompt</Label>
                      <Textarea
                        value={systemPrompt}
                        onChange={e => { setSystemPrompt(e.target.value); setSettingsDirty(true); }}
                        rows={8}
                        placeholder="Instructions that shape how the AI responds…"
                        className="font-mono text-xs"
                      />
                      <p className="text-xs text-muted-foreground">
                        This prompt is prepended to every conversation. Customize it to match your firm's tone and jurisdiction.
                      </p>
                    </div>

                    <div className="flex justify-end">
                      <Button
                        onClick={handleSaveSettings}
                        disabled={!settingsDirty || updateSettings.isPending}
                        className="gap-2"
                      >
                        {updateSettings.isPending
                          ? <Loader2 className="h-4 w-4 animate-spin" />
                          : <Save className="h-4 w-4" />}
                        Save Settings
                      </Button>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Knowledge Base Tab ── */}
          <TabsContent value="knowledge">
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Knowledge Base</CardTitle>
                  <CardDescription>
                    Documents and text the AI references when answering questions or generating drafts.
                    Supports PDF, TXT, Markdown files, or pasted text.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2 mb-6">
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-2"
                      onClick={() => setTextDialogOpen(true)}
                    >
                      <Plus className="h-4 w-4" />
                      Paste Text
                    </Button>

                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-2"
                      disabled={uploading}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      {uploading
                        ? <Loader2 className="h-4 w-4 animate-spin" />
                        : <Upload className="h-4 w-4" />}
                      Upload File
                    </Button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".txt,.md,.pdf"
                      className="hidden"
                      onChange={handleFileUpload}
                    />

                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-2"
                      onClick={() => setImportDialogOpen(true)}
                    >
                      <RefreshCw className="h-4 w-4" />
                      Import from Documents
                    </Button>
                  </div>

                  {kbLoading ? (
                    <div className="flex items-center gap-2 text-muted-foreground py-8 justify-center">
                      <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                    </div>
                  ) : kbEntries && kbEntries.length > 0 ? (
                    <div className="space-y-2">
                      {kbEntries.map(entry => (
                        <div
                          key={entry.id}
                          className="flex items-start gap-3 p-3 rounded-lg border border-border hover:bg-accent/30 transition-colors group"
                        >
                          <div className="h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center shrink-0 text-primary">
                            {sourceIcon(entry.sourceType)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium text-sm truncate">{entry.title}</span>
                              <Badge variant="outline" className="text-xs gap-1">
                                {sourceLabel(entry.sourceType)}
                              </Badge>
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                              {entry.content.slice(0, 120)}…
                            </p>
                            <p className="text-xs text-muted-foreground/60 mt-1">
                              Added {format(new Date(entry.createdAt), 'MMM d, yyyy')}
                              {entry.fileName && ` · ${entry.fileName}`}
                              {entry.fileSize && ` · ${Math.round(entry.fileSize / 1024)} KB`}
                            </p>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 opacity-0 group-hover:opacity-100 text-destructive hover:text-destructive hover:bg-destructive/10 shrink-0"
                            onClick={() => setDeleteId(entry.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-12 text-muted-foreground">
                      <BookOpen className="h-10 w-10 mx-auto mb-3 opacity-30" />
                      <p className="text-sm font-medium">No entries yet</p>
                      <p className="text-xs mt-1">
                        Upload files or paste text to give the AI context about your firm.
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* ── Paste Text Dialog ── */}
      <Dialog open={textDialogOpen} onOpenChange={setTextDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Text to Knowledge Base</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Title</Label>
              <Input
                value={newTitle}
                onChange={e => setNewTitle(e.target.value)}
                placeholder="e.g. Saudi Labor Law key provisions"
              />
            </div>
            <div className="space-y-2">
              <Label>Content</Label>
              <Textarea
                value={newContent}
                onChange={e => setNewContent(e.target.value)}
                placeholder="Paste or type the text you want the AI to reference…"
                rows={8}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTextDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={handleAddText}
              disabled={!newTitle.trim() || !newContent.trim() || addingText}
              className="gap-2"
            >
              {addingText ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Add Entry
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Import Document Dialog ── */}
      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Import from Documents</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Select a document from the Documents module to add its content to the knowledge base.
            </p>
            <div className="space-y-2">
              <Label>Document</Label>
              <Select value={selectedDocId} onValueChange={setSelectedDocId}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a document…" />
                </SelectTrigger>
                <SelectContent>
                  {documents?.map(doc => (
                    <SelectItem key={doc.id} value={String(doc.id)}>
                      {doc.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={handleImportDoc}
              disabled={!selectedDocId || importing}
              className="gap-2"
            >
              {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirm ── */}
      <AlertDialog open={!!deleteId} onOpenChange={open => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove from Knowledge Base?</AlertDialogTitle>
            <AlertDialogDescription>
              The AI will no longer reference this entry. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-destructive hover:bg-destructive/90"
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
