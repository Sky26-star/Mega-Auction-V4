import React from 'react';
import { describe,expect,it,vi } from 'vitest';
import { render,screen,fireEvent } from '@testing-library/react';
const rpc=vi.hoisted(()=>vi.fn());
vi.mock('@/lib/supabase/client',()=>({createClient:()=>({rpc,from:()=>({select:()=>({eq:()=>({eq:()=>({order:async()=>({data:[{id:'lot-mini',lot_index:1,base_price:80,status:'PENDING',player:{id:'player',name:'Test Player',role:'BATSMAN',country:'India',is_overseas:false}}],error:null})})})})})})}));
import { MiniPoolReview } from '@/components/rooms/v3/MiniPoolReview';
describe('mini host approval',()=>{
 it('persists a session/version-bound intent and shows acceptance while waiting for execution',async()=>{
  rpc.mockResolvedValue({data:{success:true,action_id:'action-mini'},error:null});
  render(<MiniPoolReview auctionId="auction" roomId="room" isHost miniSession={{id:'session',auction_id:'auction',status:'SELECTION_CLOSED',total_lots:1,closed_at:'2026-11-05T12:00:00Z',created_at:'2026-11-05T11:00:00Z',updated_at:'2026-11-05T12:00:00Z'}}/>);
  fireEvent.click(await screen.findByRole('button',{name:/START MINI AUCTION/}));
  expect(await screen.findByRole('button',{name:/START APPROVED/})).toBeDisabled();
  expect(rpc).toHaveBeenCalledWith('request_mini_start',{p_auction_id:'auction',p_session_id:'session',p_closed_at:'2026-11-05T12:00:00Z'});
 });
});
