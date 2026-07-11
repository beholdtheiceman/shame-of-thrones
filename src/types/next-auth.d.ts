import "next-auth";

declare module "next-auth" {
  interface Session {
    googleSubject?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    googleSubject?: string;
  }
}
