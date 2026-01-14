/*
  # Create stock positions table

  1. New Tables
    - `positions`
      - `id` (uuid, primary key) - Unique identifier for each position
      - `symbol` (text) - Stock ticker symbol (e.g., AAPL, GOOGL)
      - `price` (numeric) - Purchase price per share
      - `quantity` (numeric) - Number of shares owned
      - `purchase_date` (timestamptz) - When the position was acquired
      - `created_at` (timestamptz) - Record creation timestamp
      - `updated_at` (timestamptz) - Record update timestamp

  2. Security
    - Enable RLS on `positions` table
    - Add policy for public read access (for demo purposes)
    - Add policy for public insert access (for demo purposes)
    
  Note: In production, these policies should be restricted to authenticated users only
*/

CREATE TABLE IF NOT EXISTS positions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  price numeric(10, 2) NOT NULL CHECK (price >= 0),
  quantity numeric(10, 2) NOT NULL CHECK (quantity > 0),
  purchase_date timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE positions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read access to positions"
  ON positions
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Allow public insert access to positions"
  ON positions
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Allow public update access to positions"
  ON positions
  FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow public delete access to positions"
  ON positions
  FOR DELETE
  TO anon, authenticated
  USING (true);