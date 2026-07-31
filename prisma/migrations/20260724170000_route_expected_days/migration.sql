-- Expectativa de ida e volta em dias (prioridade sobre o cálculo por velocidade)
ALTER TABLE "Route" ADD COLUMN "expectedRoundTripDays" DECIMAL(65,30);
