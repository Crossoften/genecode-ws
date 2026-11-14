-- GC-N14-02: cupom de cortesia (100% + frete), criado só pelo master no admin.
ALTER TABLE `coupons`
  ADD COLUMN `freeShipping` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `createdById` CHAR(36) NULL;
