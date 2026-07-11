import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
  session: { strategy: "jwt" },
  callbacks: {
    jwt({ token, account }) {
      if (account?.providerAccountId) token.googleSubject = account.providerAccountId;
      return token;
    },
    session({ session, token }) {
      session.googleSubject = token.googleSubject as string | undefined;
      return session;
    },
  },
});
