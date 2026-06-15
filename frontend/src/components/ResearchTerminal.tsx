"use client";

import React, { useState, useRef, useCallback } from 'react';
import { fetchEventSource } from '@microsoft/fetch-event-source';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';

// Define the shape of our actual NCADEMI research output
interface ResearchResult {
  productName: string;
  vendorName: string;
  description: string;
  status: string;
}

const columnHelper = createColumnHelper<ResearchResult>();

const columns = [
  columnHelper.accessor('productName', {
    header: () => 'Product',
    cell: info => <span className="font-bold">{info.getValue()}</span>,
  }),
  columnHelper.accessor('vendorName', {
    header: () => 'Vendor',
    cell: info => info.getValue(),
  }),
  columnHelper.accessor('description', {
    header: () => 'Description',
    cell: info => <div className="max-w-md truncate">{info.getValue()}</div>,
  }),
  columnHelper.accessor('status', {
    header: () => 'Result Status',
    cell: info => (
      <span className={`px-2 py-1 rounded text-xs ${info.getValue() === 'Success' ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'}`}>
        {info.getValue()}
      </span>
    ),
  }),
];

export default function ResearchTerminal() {
  const [targetUrl, setTargetUrl] = useState('');
  const [statusMessage, setStatusMessage] = useState('Idle. Awaiting input.');
  const [isProcessing, setIsProcessing] = useState(false);
  const [results, setResults] = useState<ResearchResult[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);

  const table = useReactTable({
    data: results,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  const handleStartResearch = async () => {
    if (!targetUrl) return;
    
    setIsProcessing(true);
    setStatusMessage('Initializing research sequence...');
    setResults([]); 

    const ctrl = new AbortController();
    abortControllerRef.current = ctrl;

    try {
      // Step 1: Enqueue the job via the orchestrator
      const initRes = await fetch('http://localhost:8000/research/initial', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': 'Bearer local-bypass' 
        },
        body: JSON.stringify({ product_url: targetUrl, timeout_min: 4 }),
      });

      if (!initRes.ok) throw new Error(`API Error: ${initRes.status}`);
      const { job_id } = await initRes.json();

      // Step 2: Listen to the SSE stream
      await fetchEventSource(`http://localhost:8000/jobs/${job_id}`, {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer local-bypass',
        },
        signal: ctrl.signal,
        
        onmessage(event) {
          if (event.event === 'status') {
            const data = JSON.parse(event.data);
            setStatusMessage(`Status: ${data.status.replace('_', ' ')}...`);
          } 
          
          if (event.event === 'result') {
            const data = JSON.parse(event.data);
            const parsed = data.parsed_listing;
            
            setResults([{
              productName: parsed.product_name,
              vendorName: parsed.vendor_name,
              description: parsed.product_description,
              status: 'Success'
            }]);
            setStatusMessage('Research complete.');
          }
        },
        onclose() {
          setIsProcessing(false);
        },
        onerror(err) {
          console.error('SSE Stream Error:', err);
          setStatusMessage('Error encountered during research.');
          setIsProcessing(false);
          throw err; 
        }
      });
    } catch (error) {
      console.error('Sequence failed:', error);
      setStatusMessage(`Failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setIsProcessing(false);
    }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-8 bg-white shadow-sm border rounded-xl mt-10">
      <div className="space-y-2">
        <h2 className="text-2xl font-bold tracking-tight">N.E.R.D. Research Terminal</h2>
        <p className="text-gray-500">Enter a URL to begin unauthenticated research loop.</p>
      </div>

      <div className="flex gap-4">
        <input
          type="url"
          value={targetUrl}
          onChange={(e) => setTargetUrl(e.target.value)}
          placeholder="https://vendor.com/product-page"
          className="flex-1 p-2 border rounded-md focus:ring-2 focus:ring-blue-500 outline-none"
          disabled={isProcessing}
        />
        <button
          onClick={handleStartResearch}
          disabled={isProcessing || !targetUrl}
          className="px-6 py-2 bg-blue-600 text-white rounded-md disabled:opacity-50 hover:bg-blue-700 transition-colors"
        >
          {isProcessing ? 'Processing...' : 'Analyze'}
        </button>
      </div>

      <div 
        aria-live="polite" 
        aria-atomic="true"
        className="p-4 bg-slate-50 rounded-md text-sm font-mono text-slate-700 border-l-4 border-blue-500"
      >
        {statusMessage}
      </div>

      {results.length > 0 && (
        <div className="overflow-x-auto border rounded-md">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              {table.getHeaderGroups().map(headerGroup => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map(header => (
                    <th key={header.id} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-b">
                      {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {table.getRowModel().rows.map(row => (
                <tr key={row.id} className="hover:bg-slate-50">
                  {row.getVisibleCells().map(cell => (
                    <td key={cell.id} className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
