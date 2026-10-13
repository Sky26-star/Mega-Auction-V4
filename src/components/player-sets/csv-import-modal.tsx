'use client';

// src/components/player-sets/csv-import-modal.tsx
// CSV Import Modal for Player Master Data V2

import React, { useState } from 'react';
import { parsePlayerCSV } from '@/lib/csv-parser';
import type { CSVImportResult, PlayerFormInput } from '@/lib/types/player-set';
import { CATEGORY_UI_LABELS } from '@/lib/types/player-set';
import { X, UploadCloud, FileText, CheckCircle2, AlertTriangle, Loader2, AlertCircle } from 'lucide-react';

interface CSVImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (players: PlayerFormInput[]) => Promise<number>;
}

export function CSVImportModal({ isOpen, onClose, onImport }: CSVImportModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [importResult, setImportResult] = useState<CSVImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [importedCount, setImportedCount] = useState(0);

  if (!isOpen) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    setFile(selectedFile);
    setError(null);
    setIsSuccess(false);

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      if (!text) {
        setError('Selected file is empty');
        return;
      }
      const result = parsePlayerCSV(text);
      setImportResult(result);
    };
    reader.onerror = () => {
      setError('Failed to read file');
    };
    reader.readAsText(selectedFile);
  };

  const handleImportSubmit = async () => {
    if (!importResult || importResult.validRows.length === 0) {
      setError('No valid rows available for import');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const count = await onImport(importResult.validRows);
      setImportedCount(count);
      setIsSuccess(true);
      setTimeout(() => {
        onClose();
        setFile(null);
        setImportResult(null);
        setIsSuccess(false);
      }, 1500);
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Failed to import players');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-3xl rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <div className="w-9 h-9 rounded-xl bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center">
              <UploadCloud className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Import Players via CSV (V2)</h2>
              <p className="text-xs text-slate-400">Upload a CSV file containing player details and career statistics</p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isLoading}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6 overflow-y-auto flex-1">
          {error && (
            <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 flex items-start space-x-3 text-red-400 text-sm">
              <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {isSuccess && (
            <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center space-x-3 text-emerald-400 text-sm">
              <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
              <span>Successfully imported {importedCount} players!</span>
            </div>
          )}

          {/* Upload Dropzone */}
          <div className="border-2 border-dashed border-slate-700/80 hover:border-emerald-500/50 rounded-2xl p-6 text-center bg-slate-800/30 transition-colors relative cursor-pointer group">
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={handleFileChange}
              disabled={isLoading}
              className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
            />
            <div className="w-12 h-12 rounded-full bg-emerald-500/10 text-emerald-400 mx-auto mb-3 flex items-center justify-center border border-emerald-500/20 group-hover:scale-110 transition-transform">
              <FileText className="w-6 h-6" />
            </div>
            <p className="text-sm font-semibold text-white mb-1">
              {file ? file.name : 'Click or drag CSV file here to upload'}
            </p>
            <p className="text-xs text-slate-400 max-w-xl mx-auto leading-relaxed">
              Required headers: <code className="text-emerald-300 bg-slate-800 px-1.5 py-0.5 rounded font-mono">name, country, role</code>. Optional: <code className="text-emerald-300 bg-slate-800 px-1.5 py-0.5 rounded font-mono">age, batting_hand, category, base_price, image_url, matches, runs...</code>
            </p>
          </div>

          {/* Import Summary & Errors */}
          {importResult && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-between">
                  <span className="text-xs font-semibold text-emerald-300">Valid Rows Ready</span>
                  <span className="text-lg font-bold text-emerald-400">{importResult.validRows.length}</span>
                </div>
                <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-between">
                  <span className="text-xs font-semibold text-amber-300">Validation Errors</span>
                  <span className="text-lg font-bold text-amber-400">{importResult.errors.length}</span>
                </div>
              </div>

              {/* Errors List */}
              {importResult.errors.length > 0 && (
                <div className="p-4 rounded-xl bg-slate-950 border border-amber-500/30 max-h-48 overflow-y-auto space-y-2">
                  <h4 className="text-xs font-bold text-amber-400 flex items-center gap-1.5 sticky top-0 bg-slate-950 py-1">
                    <AlertTriangle className="w-4 h-4" />
                    Row Validation Errors (Skipped)
                  </h4>
                  {importResult.errors.map((err, idx) => (
                    <div key={idx} className="text-xs text-slate-300 border-b border-slate-800/80 pb-1.5 last:border-0">
                      <span className="font-mono text-amber-400 font-bold">Row {err.rowNumber} [{err.field}]:</span> {err.message}
                    </div>
                  ))}
                </div>
              )}

              {/* Preview Table of Valid Rows */}
              {importResult.validRows.length > 0 && (
                <div>
                  <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                    Preview (First 5 valid rows)
                  </h4>
                  <div className="overflow-x-auto rounded-xl border border-slate-800">
                    <table className="w-full text-left text-xs text-slate-300">
                      <thead className="bg-slate-800/80 text-slate-400 uppercase text-[10px] tracking-wider">
                        <tr>
                          <th className="px-3 py-2">Name</th>
                          <th className="px-3 py-2">Country</th>
                          <th className="px-3 py-2">Role</th>
                          <th className="px-3 py-2">Category</th>
                          <th className="px-3 py-2">Base Price</th>
                          <th className="px-3 py-2">Overseas</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800">
                        {importResult.validRows.slice(0, 5).map((row, i) => (
                          <tr key={i} className="hover:bg-slate-800/30">
                            <td className="px-3 py-2 font-medium text-white">{row.name}</td>
                            <td className="px-3 py-2">{row.country}</td>
                            <td className="px-3 py-2">{row.role}</td>
                            <td className="px-3 py-2">{CATEGORY_UI_LABELS[row.category] || row.category}</td>
                            <td className="px-3 py-2 font-mono">{row.base_price} Lakhs</td>
                            <td className="px-3 py-2">{row.is_overseas ? 'Yes' : 'No'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 border-t border-slate-800 bg-slate-900/50 flex items-center justify-end space-x-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="px-4 py-2.5 rounded-xl border border-slate-700 text-slate-300 text-xs font-semibold hover:bg-slate-800 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleImportSubmit}
            disabled={isLoading || !importResult || importResult.validRows.length === 0}
            className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-lg shadow-emerald-600/30 flex items-center space-x-2 transition-colors disabled:opacity-50"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Importing...</span>
              </>
            ) : (
              <span>Import {importResult?.validRows.length || 0} Valid Players</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
