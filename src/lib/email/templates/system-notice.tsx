import { Body, Container, Head, Heading, Html, Link, Preview, Section, Text } from "@react-email/components";

export type SystemNoticeProps = {
  productName: string;
  primaryColor: string;
  heading: string;
  body: string;
  ctaLabel?: string;
  ctaUrl?: string;
};

// Generic one-off notice (agent invites, password reset) — same visual
// system as ticket-notification, without the ticket-specific fields.
export function SystemNoticeEmail({ productName, primaryColor, heading, body, ctaLabel, ctaUrl }: SystemNoticeProps) {
  return (
    <Html>
      <Head />
      <Preview>{heading}</Preview>
      <Body style={{ backgroundColor: "#EBEBEB", fontFamily: "Helvetica, Arial, sans-serif", margin: 0, padding: "32px 0" }}>
        <Container style={{ backgroundColor: "#FFFFFF", padding: "32px", maxWidth: "480px", border: "1px solid #CCCCCC" }}>
          <Text style={{ fontSize: "13px", fontWeight: 600, color: "#000000", margin: "0 0 24px" }}>{productName}</Text>
          <Heading style={{ fontSize: "20px", fontWeight: 700, color: "#000000", margin: "0 0 16px" }}>{heading}</Heading>
          <Text style={{ fontSize: "14px", color: "#000000", margin: "0 0 24px", whiteSpace: "pre-wrap" }}>{body}</Text>
          {ctaUrl && ctaLabel && (
            <Link
              href={ctaUrl}
              style={{
                display: "inline-block",
                backgroundColor: primaryColor,
                color: "#FFFFFF",
                fontSize: "13px",
                fontWeight: 600,
                padding: "10px 20px",
                borderRadius: "999px",
                textDecoration: "none",
              }}
            >
              {ctaLabel}
            </Link>
          )}
          <Section style={{ marginTop: "32px", borderTop: "1px solid #EBEBEB", paddingTop: "16px" }}>
            <Text style={{ fontSize: "11px", color: "#AEAEAE", margin: 0 }}>Sent by {productName}.</Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}
