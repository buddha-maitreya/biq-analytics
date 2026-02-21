CREATE TABLE IF NOT EXISTS "user" (
"id" text PRIMARY KEY NOT NULL,
"name" text NOT NULL,
"email" text NOT NULL,
"emailVerified" boolean DEFAULT false NOT NULL,
"image" text,
"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
CONSTRAINT "user_email_unique" UNIQUE("email")
);
CREATE TABLE IF NOT EXISTS "session" (
"id" text PRIMARY KEY NOT NULL,
"expiresAt" timestamp with time zone NOT NULL,
"token" text NOT NULL,
"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
"updatedAt" timestamp with time zone NOT NULL,
"ipAddress" text,
"userAgent" text,
"userId" text NOT NULL,
"activeOrganizationId" text,
CONSTRAINT "session_token_unique" UNIQUE("token")
);
CREATE TABLE IF NOT EXISTS "account" (
"id" text PRIMARY KEY NOT NULL,
"accountId" text NOT NULL,
"providerId" text NOT NULL,
"userId" text NOT NULL,
"accessToken" text,
"refreshToken" text,
"idToken" text,
"accessTokenExpiresAt" timestamp with time zone,
"refreshTokenExpiresAt" timestamp with time zone,
"scope" text,
"password" text,
"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
"updatedAt" timestamp with time zone NOT NULL
);
CREATE TABLE IF NOT EXISTS "verification" (
"id" text PRIMARY KEY NOT NULL,
"identifier" text NOT NULL,
"value" text NOT NULL,
"expiresAt" timestamp with time zone NOT NULL,
"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "organization" (
"id" text PRIMARY KEY NOT NULL,
"name" text NOT NULL,
"slug" text NOT NULL,
"logo" text,
"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
"metadata" text,
CONSTRAINT "organization_slug_unique" UNIQUE("slug")
);
CREATE TABLE IF NOT EXISTS "member" (
"id" text PRIMARY KEY NOT NULL,
"organizationId" text NOT NULL,
"userId" text NOT NULL,
"role" text NOT NULL,
"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "invitation" (
"id" text PRIMARY KEY NOT NULL,
"organizationId" text NOT NULL,
"email" text NOT NULL,
"role" text,
"status" text NOT NULL,
"expiresAt" timestamp with time zone NOT NULL,
"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
"inviterId" text NOT NULL
);
CREATE TABLE IF NOT EXISTS "jwks" (
"id" text PRIMARY KEY NOT NULL,
"publicKey" text NOT NULL,
"privateKey" text NOT NULL,
"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
"expiresAt" timestamp with time zone
);
CREATE TABLE IF NOT EXISTS "apikey" (
"id" text PRIMARY KEY NOT NULL,
"name" text,
"start" text,
"prefix" text,
"key" text NOT NULL,
"userId" text NOT NULL,
"refillInterval" integer,
"refillAmount" integer,
"lastRefillAt" timestamp with time zone,
"enabled" boolean DEFAULT true NOT NULL,
"rateLimitEnabled" boolean DEFAULT true NOT NULL,
"rateLimitTimeWindow" integer DEFAULT 86400000 NOT NULL,
"rateLimitMax" integer DEFAULT 10 NOT NULL,
"requestCount" integer DEFAULT 0 NOT NULL,
"remaining" integer,
"lastRequest" timestamp with time zone,
"expiresAt" timestamp with time zone,
"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
"permissions" text,
"metadata" text
);
-- Foreign keys
ALTER TABLE "account" ADD CONSTRAINT IF NOT EXISTS "account_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "apikey" ADD CONSTRAINT IF NOT EXISTS "apikey_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "invitation" ADD CONSTRAINT IF NOT EXISTS "invitation_organizationId_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "invitation" ADD CONSTRAINT IF NOT EXISTS "invitation_inviterId_user_id_fk" FOREIGN KEY ("inviterId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "member" ADD CONSTRAINT IF NOT EXISTS "member_organizationId_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "member" ADD CONSTRAINT IF NOT EXISTS "member_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "session" ADD CONSTRAINT IF NOT EXISTS "session_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
-- Indexes
CREATE INDEX IF NOT EXISTS "account_userId_idx" ON "account" USING btree ("userId");
CREATE INDEX IF NOT EXISTS "apikey_userId_idx" ON "apikey" USING btree ("userId");
CREATE INDEX IF NOT EXISTS "apikey_key_idx" ON "apikey" USING btree ("key");
CREATE INDEX IF NOT EXISTS "invitation_organizationId_idx" ON "invitation" USING btree ("organizationId");
CREATE INDEX IF NOT EXISTS "invitation_email_idx" ON "invitation" USING btree ("email");
CREATE INDEX IF NOT EXISTS "member_organizationId_idx" ON "member" USING btree ("organizationId");
CREATE INDEX IF NOT EXISTS "member_userId_idx" ON "member" USING btree ("userId");
CREATE INDEX IF NOT EXISTS "session_userId_idx" ON "session" USING btree ("userId");
CREATE INDEX IF NOT EXISTS "verification_identifier_idx" ON "verification" USING btree ("identifier");